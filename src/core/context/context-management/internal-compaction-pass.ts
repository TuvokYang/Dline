import type { ApiHandler } from "@core/api"
import { isOutputLimitExceededError } from "@core/api/stream/OutputLimitExceededError"
import { createIdentityFactory } from "@core/api/transform/block-identity"
import { ApiUsageAccumulator } from "@core/api/transform/usage-accumulator"
import { parseAssistantMessageV2, type ToolUse } from "@core/assistant-message"
import type { CompactionProviderInput } from "@core/task/compaction/CompactionRequestReplay"
import type { ExplicitInstructionRequestScope } from "@core/task/explicit-instructions/ExplicitInstructionRequestScope"
import { ClineDefaultTool } from "@shared/tools"
import cloneDeep from "clone-deep"
import type { CompactionRetryPolicy } from "./compaction-retry-policy"
import type { CompactionPassIdentity } from "./target-window-fitting"

export interface InternalCompactionUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalTokens: number
}

export interface InternalCompactionPassResult {
	summary: string
	usage: InternalCompactionUsage
}

export interface RunInternalCompactionPassInput {
	api: ApiHandler
	providerInput: CompactionProviderInput
	explicitInstructions: ExplicitInstructionRequestScope
	taskNamespace?: string
	attemptId?: string
	/** Every accepted Provider chunk, before summary parsing, for request lifecycle observers. */
	onChunk?(chunk: unknown): void | Promise<void>
	/** Streamed summary snapshots delivered without retry lifecycle state. */
	onSummaryUpdate?(context: string): void | Promise<void>
}

export interface InternalCompactionAttemptIdentity {
	attemptIndex: number
	authorizationAttemptId: string
}

export interface InternalCompactionPassAttemptResult extends InternalCompactionPassResult, InternalCompactionAttemptIdentity {}

export type InternalCompactionPassRetryEvent =
	| {
			kind: "pass_retry"
			retryAttempt: number
			maxRetryAttempts: number
			failedAttempt: InternalCompactionAttemptIdentity
			nextAttempt: InternalCompactionAttemptIdentity
			error: unknown
	  }
	| {
			kind: "openai_max_output_replay"
			providerOutputCap: number
			failedAttempt: InternalCompactionAttemptIdentity
			nextAttempt: InternalCompactionAttemptIdentity
			error: unknown
	  }

export interface RunInternalCompactionPassWithRetryInput
	extends Omit<RunInternalCompactionPassInput, "attemptId" | "onChunk" | "onSummaryUpdate"> {
	passIdentity: CompactionPassIdentity
	retryPolicy: CompactionRetryPolicy
	allowOpenAiMaxOutputReplay?: boolean
	initialAttemptIndex?: number
	attemptIdFactory(attemptIndex: number): string
	waitForRetry(retryAttempt: number): Promise<void>
	onRetry?(event: InternalCompactionPassRetryEvent): void | Promise<void>
	onChunk?(chunk: unknown, attempt: InternalCompactionAttemptIdentity): void | Promise<void>
	onSummaryUpdate?(context: string, attempt: InternalCompactionAttemptIdentity): void | Promise<void>
}

/** Execute one compaction Provider request without ordinary UI or history side effects. */
export async function runInternalCompactionPass(input: RunInternalCompactionPassInput): Promise<InternalCompactionPassResult> {
	input.explicitInstructions.beginProviderAttempt(input.attemptId)
	const consumePort = input.explicitInstructions.createConsumePort()
	const stream = input.api.createMessage(
		input.providerInput.systemPrompt,
		input.providerInput.messages,
		input.providerInput.tools,
		{
			serverTools: input.providerInput.serverTools,
			taskNamespace: input.taskNamespace,
			...(input.providerInput.providerOutputCap === undefined
				? {}
				: {
						generation: {
							purpose: "compaction",
							maxOutputTokens: input.providerInput.providerOutputCap,
						} as const,
					}),
		},
	)

	let assistantText = ""
	let nativeSummary: string | undefined
	let usage: InternalCompactionUsage | undefined
	const usageAccumulator = new ApiUsageAccumulator()
	let lastPublishedSummary: string | undefined
	const nativeArguments = new Map<string, string>()
	const publishSummarySnapshot = async (context: string | undefined): Promise<void> => {
		const snapshot = context?.trim()
		if (!snapshot || snapshot === lastPublishedSummary) return
		lastPublishedSummary = snapshot
		await input.onSummaryUpdate?.(snapshot)
	}

	for await (const chunk of stream) {
		await input.onChunk?.(chunk)
		switch (chunk.type) {
			case "text":
				assistantText += chunk.text
				await publishSummarySnapshot(parseXmlSummarySnapshot(assistantText))
				break
			case "tool_calls": {
				if (chunk.tool_call.function.name !== ClineDefaultTool.SUMMARIZE_TASK) break
				const key = chunk.tool_index === undefined ? chunk.function_id : String(chunk.tool_index)
				const next = normalizeArguments(chunk.tool_call.function.arguments)
				// Responses-family adapters emit the complete arguments twice: once as the
				// argument delta and again on output_item.done. A chunk that is already a
				// complete summary payload is authoritative; otherwise keep appending
				// incremental deltas until a complete payload arrives.
				const completeSnapshot = parseSummaryArguments(next)
				if (completeSnapshot !== undefined) {
					nativeArguments.set(key, next)
					nativeSummary = completeSnapshot
					await publishSummarySnapshot(completeSnapshot)
				} else {
					const accumulated = `${nativeArguments.get(key) ?? ""}${next}`
					nativeArguments.set(key, accumulated)
					await publishSummarySnapshot(parsePartialSummaryArguments(accumulated))
					// Chat-family adapters emit complete argument chunks without a completion phase.
					if (chunk.phase === undefined || chunk.phase === "completed") {
						const completed = parseSummaryArguments(accumulated)
						if (completed !== undefined) {
							nativeSummary = completed
							await publishSummarySnapshot(completed)
						}
					}
				}
				break
			}
			case "usage": {
				const current = usageAccumulator.apply(chunk).usage
				usage = {
					...current,
					totalTokens: current.inputTokens + current.outputTokens + current.cacheWriteTokens + current.cacheReadTokens,
				}
				break
			}
			case "reasoning":
			case "server_tool":
				break
		}
	}

	const summary = nativeSummary ?? parseXmlSummary(assistantText)
	if (!summary) {
		throw new Error("Internal compaction Pass did not return a valid summarize_task context")
	}
	if (!usage || usage.totalTokens <= 0) {
		throw new Error("Internal compaction Pass did not return reliable usage")
	}
	const consumed = consumePort.consumeTool(ClineDefaultTool.SUMMARIZE_TASK)
	if (!consumed.ok) {
		throw new Error(`Internal compaction summarize_task authorization failed: ${consumed.code}`)
	}
	return { summary, usage }
}

/** Own every attempt for one immutable hidden Pass without entering Task auto-retry. */
export async function runInternalCompactionPassWithRetry(
	input: RunInternalCompactionPassWithRetryInput,
): Promise<InternalCompactionPassAttemptResult> {
	const frozenProviderInput = cloneDeep(input.providerInput)
	let currentProviderInput = cloneDeep(frozenProviderInput)
	let currentAttempt = createAttemptIdentity(input, input.initialAttemptIndex ?? 0)
	let openAiMaxOutputReplayUsed = false

	while (true) {
		try {
			const result = await runInternalCompactionPass({
				api: input.api,
				providerInput: currentProviderInput,
				explicitInstructions: input.explicitInstructions,
				taskNamespace: input.taskNamespace,
				attemptId: currentAttempt.authorizationAttemptId,
				onChunk: (chunk) => input.onChunk?.(chunk, currentAttempt),
				onSummaryUpdate: (context) => input.onSummaryUpdate?.(context, currentAttempt),
			})
			input.retryPolicy.reset()
			return { ...result, ...currentAttempt }
		} catch (error) {
			const replayCap =
				input.allowOpenAiMaxOutputReplay === false
					? undefined
					: getOpenAiMaxOutputReplayCap(frozenProviderInput.providerOutputCap, error, openAiMaxOutputReplayUsed)
			if (replayCap !== undefined) {
				openAiMaxOutputReplayUsed = true
				const nextAttempt = createAttemptIdentity(input, currentAttempt.attemptIndex + 1)
				currentProviderInput = { ...cloneDeep(frozenProviderInput), providerOutputCap: replayCap }
				await input.onRetry?.({
					kind: "openai_max_output_replay",
					providerOutputCap: replayCap,
					failedAttempt: currentAttempt,
					nextAttempt,
					error,
				})
				currentAttempt = nextAttempt
				continue
			}
			if (isOpenAiMaxOutputFailure(error)) {
				throw error
			}

			const retryDecision = input.retryPolicy.registerFailure(input.passIdentity)
			if (retryDecision.action === "exhausted") {
				throw error
			}
			const nextAttempt = createAttemptIdentity(input, currentAttempt.attemptIndex + 1)
			await input.onRetry?.({
				kind: "pass_retry",
				retryAttempt: retryDecision.retryAttempt,
				maxRetryAttempts: retryDecision.maxRetryAttempts,
				failedAttempt: currentAttempt,
				nextAttempt,
				error,
			})
			await input.waitForRetry(retryDecision.retryAttempt)
			currentAttempt = nextAttempt
			// Keep the current provider input, so a reduced OpenAI max-output replay cap survives ordinary Pass retries.
			currentProviderInput = cloneDeep(currentProviderInput)
		}
	}
}

function createAttemptIdentity(
	input: RunInternalCompactionPassWithRetryInput,
	attemptIndex: number,
): InternalCompactionAttemptIdentity {
	return {
		attemptIndex,
		authorizationAttemptId: input.attemptIdFactory(attemptIndex),
	}
}

function getOpenAiMaxOutputReplayCap(
	initialProviderOutputCap: number | undefined,
	error: unknown,
	replayUsed: boolean,
): number | undefined {
	if (replayUsed || !isOpenAiMaxOutputFailure(error) || initialProviderOutputCap === undefined) return undefined
	const replayCap = Math.floor(initialProviderOutputCap * 0.9)
	return replayCap > 0 ? replayCap : undefined
}

function isOpenAiMaxOutputFailure(error: unknown): boolean {
	return (
		isOutputLimitExceededError(error) &&
		((error.protocol === "openai_chat" && error.reason === "length") ||
			(error.protocol === "openai_responses" && error.reason === "max_output_tokens"))
	)
}

function normalizeArguments(value: unknown): string {
	if (typeof value === "string") return value
	if (value === undefined) return ""
	return JSON.stringify(value)
}

function parseSummaryArguments(value: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(value)
		if (typeof parsed !== "object" || parsed === null || !("context" in parsed)) return undefined
		const context = (parsed as { context?: unknown }).context
		return typeof context === "string" && context.trim() ? context.trim() : undefined
	} catch {
		return undefined
	}
}

function parsePartialSummaryArguments(value: string): string | undefined {
	const match = value.match(/"context"\s*:\s*"((?:[^"\\]|\\.)*)/)
	if (!match) return undefined
	try {
		const context: unknown = JSON.parse(`"${match[1]}"`)
		return typeof context === "string" && context.trim() ? context.trim() : undefined
	} catch {
		return undefined
	}
}

function parseXmlSummary(text: string): string | undefined {
	return parseXmlSummaryBlock(text, false)
}

function parseXmlSummarySnapshot(text: string): string | undefined {
	return parseXmlSummaryBlock(text, true)
}

function parseXmlSummaryBlock(text: string, allowPartial: boolean): string | undefined {
	if (!text.trim()) return undefined
	let ts = 0
	const identities = createIdentityFactory(() => String(++ts))
	const blocks = parseAssistantMessageV2(text, {
		getOrCreateTsForBlock: () => ++ts,
		getOrCreateToolIdentityForBlock: () => ({
			function_id: identities.nextFunctionId(),
			dline_tid: identities.nextTraceId(),
		}),
	})
	const summaries = blocks.filter(
		(block): block is ToolUse =>
			block.type === "tool_use" &&
			block.name === ClineDefaultTool.SUMMARIZE_TASK &&
			(allowPartial || !block.partial) &&
			typeof block.params.context === "string" &&
			block.params.context.trim().length > 0,
	)
	return summaries.length === 1 ? summaries[0].params.context?.trim() : undefined
}
