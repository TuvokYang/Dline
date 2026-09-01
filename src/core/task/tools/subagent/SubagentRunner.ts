import * as path from "node:path"
import type { ApiHandler, buildApiHandler } from "@core/api"
import { recordProviderAdapterInput, recordProviderAdapterOutput } from "@core/api/debug/api-conversation-log"
import type { WebSearchRoutingPlan } from "@core/api/server-tools"
import { isOutputLimitExceededError } from "@core/api/stream/OutputLimitExceededError"
import { createIdentityFactory } from "@core/api/transform/block-identity"
import type { ApiProviderStreamChunk } from "@core/api/transform/stream"
import { createStreamNormalizer, normalizeApiStream } from "@core/api/transform/stream-identity-normalizer"
import { ApiUsageAccumulator } from "@core/api/transform/usage-accumulator"
import { parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import { discoverAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { getSystemPrompt, type SystemPromptContext } from "@core/prompts/system-prompt"
import type { ProviderRequestRoundAdmission } from "@core/task/performance/provider-request-round-port"
import { resolveRequestWebSearchRoutingPlan } from "@core/task/RequestApiScope"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { DEFAULT_API_PROVIDER } from "@shared/api"
import {
	ClineAssistantContent,
	ClineAssistantToolUseBlock,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserContent,
} from "@shared/messages"
import { resolvePromptProfile } from "@shared/resolve-prompt-profile"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool, ClineTool } from "@shared/tools"
import { ContextManager } from "@/core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@/core/context/context-management/context-error-handling"
import {
	computeCompactTrigger,
	computeSummarizeBudget,
	getContextWindowInfo,
	shouldCompactProjectedUsage,
} from "@/core/context/context-management/context-window-utils"
import { HostRegistryInfo } from "@/registry"
import { ClineError, ClineErrorType } from "@/services/error"
import { ApiFormat } from "@/shared/proto/dline/models/metadata"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { isNativeToolCallingConfig, isNextGenModelFamily } from "@/utils/model-utils"
import { TaskState } from "../../TaskState"
import { canonicalizeAttemptCompletionParams } from "../attempt-completion-params"
import { ServerToolLifecycle } from "../ServerToolLifecycle"
import { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { SUBAGENT_COMPLETION_CONTRACT, SubagentBuilder } from "./SubagentBuilder"
import type { SubagentFinishReason, SubagentProgressUpdate, SubagentRunStats } from "./SubagentExecutor"
import {
	buildSubagentOutputBudgetPrompt,
	resolveSubagentOutputBudget,
	truncateTextToSubagentOutputBudget,
} from "./SubagentOutputBudget"

const MAX_EMPTY_ASSISTANT_RETRIES = 3
const MAX_INVALID_COMPLETION_RETRIES = 3
const INITIAL_STREAM_RETRY_DELAYS_MS = [5_000, 8_000, 11_000, 14_000, 17_000] as const
const MAX_INITIAL_STREAM_ATTEMPTS = INITIAL_STREAM_RETRY_DELAYS_MS.length + 1
const SUBAGENT_COMPLETION_CALL_EXAMPLE =
	'Call attempt_completion with a non-empty result, for example: attempt_completion(result="...").'

export interface SubagentRunnerOptions {
	/** Keep ordinary subagents coupled to parent Task cancellation unless an explicit Activity owns their lifecycle. */
	inheritTaskAbort?: boolean
}

class ProviderExecutionCompletion {
	private toolCount = 0
	private completedToolCount = 0
	private failedToolCount = 0
	private toolsKnown = false
	private finished = false

	constructor(private readonly admission?: ProviderRequestRoundAdmission) {}

	setToolCount(toolCount: number): void {
		this.toolCount = toolCount
		this.toolsKnown = true
	}

	completeTool(): void {
		this.completedToolCount += 1
	}

	failTool(): void {
		this.failedToolCount += 1
	}

	finish(): void {
		if (this.finished) return
		this.finished = true
		if (!this.admission) return
		if (!this.toolsKnown || this.toolCount === 0) {
			this.admission.completeProviderOnly()
			return
		}
		const cancelledToolCount = Math.max(0, this.toolCount - this.completedToolCount - this.failedToolCount)
		this.admission.completeTools({
			toolCount: this.toolCount,
			completedToolCount: this.completedToolCount,
			failedToolCount: this.failedToolCount,
			cancelledToolCount,
		})
	}
}

function formatApiFormat(apiFormat: ApiFormat | undefined): string | undefined {
	if (apiFormat === undefined) return undefined
	return ApiFormat[apiFormat]?.toLowerCase()
}

function buildCompletionRequiredReminder(usingNativeToolCalls: boolean): string {
	return `${formatResponse.noToolsUsed(usingNativeToolCalls)}\n\n${SUBAGENT_COMPLETION_CONTRACT}\n\n${SUBAGENT_COMPLETION_CALL_EXAMPLE}`
}

function buildMissingCompletionResultReminder(): string {
	return `The attempt_completion call was rejected because it did not include a non-empty result.\n\n${SUBAGENT_COMPLETION_CONTRACT}\n\n${SUBAGENT_COMPLETION_CALL_EXAMPLE}`
}

function buildCompletionRequiredFailure(): string {
	return `Subagent did not complete through the required protocol.\n\n${SUBAGENT_COMPLETION_CONTRACT}\n\n${SUBAGENT_COMPLETION_CALL_EXAMPLE}`
}

function buildInvalidCompletionFailure(): string {
	return `Subagent repeatedly called attempt_completion without a non-empty result.\n\n${SUBAGENT_COMPLETION_CONTRACT}\n\n${SUBAGENT_COMPLETION_CALL_EXAMPLE}`
}

function buildFinishReminder(reason: SubagentFinishReason): string {
	const trigger =
		reason === "timeout" ? "The subagent time limit was reached." : "The user requested that the subagent finish now."
	return `${trigger}\n\nStop all further exploration. On your next response, call attempt_completion with a non-empty result that summarizes the useful findings already collected. Do not call any other tool. If the investigation is incomplete, state the remaining limitations in the result.\n\n${SUBAGENT_COMPLETION_CALL_EXAMPLE}`
}

export type SubagentRunStatus = "completed" | "failed" | "cancelled"

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	retryable?: boolean
	stats: SubagentRunStats
}

interface SubagentRequestUsageState {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalTokens: number
	totalCost?: number
}

interface SubagentUsageState {
	currentRequest: SubagentRequestUsageState
	lastRequest?: SubagentRequestUsageState
}

interface SubagentToolCall {
	function_id: string
	dline_tid: string
	provider_metadata?: { item_id?: string }
	signature?: string
	name: string
	input: unknown
	isNativeToolCall: boolean
}

interface SubagentContextState {
	conversationHistoryDeletedRange?: [number, number]
}

function createEmptyRequestUsageState(): SubagentRequestUsageState {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheWriteTokens: 0,
		cacheReadTokens: 0,
		totalTokens: 0,
	}
}

function serializeToolResult(result: unknown): string {
	if (typeof result === "string") {
		return result
	}

	if (Array.isArray(result)) {
		return result
			.map((item) => {
				if (!item || typeof item !== "object") {
					return String(item)
				}

				const maybeText = (item as { text?: string }).text
				if (typeof maybeText === "string") {
					return maybeText
				}

				return JSON.stringify(item)
			})
			.join("\n")
	}

	return JSON.stringify(result, null, 2)
}

function toToolUseParams(input: unknown): Partial<Record<string, string>> {
	if (!input || typeof input !== "object") {
		return {}
	}

	const params: Record<string, string> = {}
	for (const [key, value] of Object.entries(input)) {
		params[key] = typeof value === "string" ? value : JSON.stringify(value)
	}

	return params
}

function formatToolArgPreview(value: string, maxLength = 48): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maxLength) {
		return normalized
	}
	return `${normalized.slice(0, maxLength - 3)}...`
}

function formatToolCallPreview(toolName: string, params: Partial<Record<string, string>>): string {
	const entries = Object.entries(params).filter(([, value]) => value !== undefined)
	const visibleEntries = entries.slice(0, 3)
	const omittedCount = Math.max(0, entries.length - visibleEntries.length)

	const args = visibleEntries
		.map(([key, value]) => `${key}=${formatToolArgPreview(value ?? "")}`)
		.concat(omittedCount > 0 ? [`...+${omittedCount}`] : [])
		.join(", ")

	return `${toolName}(${args})`
}

function waitForSubagentRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(signal.reason ?? new Error("Subagent retry wait was aborted."))
	}

	return new Promise((resolve, reject) => {
		let timer: NodeJS.Timeout | undefined
		const onAbort = () => {
			if (timer) clearTimeout(timer)
			signal?.removeEventListener("abort", onAbort)
			reject(signal?.reason ?? new Error("Subagent retry wait was aborted."))
		}

		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, delayMs)
		signal?.addEventListener("abort", onAbort, { once: true })
	})
}

function normalizeToolCallArguments(argumentsPayload: unknown): string {
	if (typeof argumentsPayload === "string") {
		return argumentsPayload
	}

	try {
		return JSON.stringify(argumentsPayload ?? {})
	} catch {
		return "{}"
	}
}

function toAssistantToolUseBlock(call: SubagentToolCall): ClineAssistantToolUseBlock {
	return {
		type: "tool_use",
		function_id: call.function_id,
		dline_tid: call.dline_tid,
		provider_metadata: call.provider_metadata,
		name: call.name,
		input: call.input,
		signature: call.signature,
	}
}

function parseNonNativeToolCalls(assistantText: string): SubagentToolCall[] {
	let ephemeralTs = Date.now()
	const identities = new Map<string, { function_id: string; dline_tid: string }>()
	const registry = {
		getOrCreateTsForBlock: (_key: string) => ++ephemeralTs,
		getOrCreateToolIdentityForBlock: (key: string) => {
			const existing = identities.get(key)
			if (existing) return existing
			const index = identities.size + 1
			const identity = {
				function_id: `subagent_xml_function_${index}`,
				dline_tid: `subagent_xml_tid_${index}`,
			}
			identities.set(key, identity)
			return identity
		},
	}
	const parsedBlocks = parseAssistantMessageV2(assistantText, registry)

	return parsedBlocks
		.filter((block): block is ToolUse => block.type === "tool_use")
		.filter((block) => !block.partial)
		.map((block) => ({
			function_id: block.function_id,
			dline_tid: block.dline_tid,
			name: block.name,
			input: block.params,
			signature: block.signature,
			isNativeToolCall: false,
		}))
}

function pushSubagentToolResultBlock(
	toolResultBlocks: ClineUserContent[],
	call: SubagentToolCall,
	label: string,
	content: string,
): void {
	if (call.isNativeToolCall) {
		toolResultBlocks.push({
			type: "tool_result",
			function_id: call.function_id,
			dline_tid: call.dline_tid,
			content,
		})
		return
	}

	toolResultBlocks.push({
		type: "text",
		text: `${label} Result:\n${content}`,
	})
}

/** Raised when a tool wait is abandoned because the run was interrupted. */
class SubagentToolInterruptedError extends Error {
	constructor() {
		super("Subagent tool execution was interrupted.")
		this.name = "SubagentToolInterruptedError"
	}
}

export class SubagentRunner {
	private readonly agent: SubagentBuilder
	private readonly apiHandler: ApiHandler
	private readonly allowedTools: ClineDefaultTool[]
	private activeApiAbort: (() => void) | undefined
	private activeRetryAbortController: AbortController | undefined
	private abortRequested = false
	private finishRequested: SubagentFinishReason | undefined
	private completionOnly = false
	private running = false
	private activeCommandExecutions = 0
	private abortingCommands = false
	private apiLogRequestIndex = 0
	private interruptionController: AbortController | undefined

	constructor(
		private baseConfig: TaskConfig,
		subagentName = "subagent",
		agentConfig?: AgentBaseConfig,
		private readonly options: SubagentRunnerOptions = {},
	) {
		this.agent = new SubagentBuilder(baseConfig, subagentName, agentConfig)
		this.apiHandler = this.agent.getApiHandler()
		this.allowedTools = this.agent.getAllowedTools()
	}

	async abort(): Promise<void> {
		this.abortRequested = true
		await this.interruptActiveWork("abort")
	}

	async requestFinish(reason: SubagentFinishReason): Promise<boolean> {
		if (!this.running || this.finishRequested || this.completionOnly || this.shouldAbort()) return false
		this.finishRequested = reason
		await this.interruptActiveWork("finish")
		return true
	}

	/**
	 * Wait for a tool call, but stop waiting once the run is interrupted.
	 *
	 * A tool handler has no cancellation channel of its own, and the abort flag
	 * is only polled between tool calls. A tool that never settles - a contended
	 * parser lock, a wedged host request - therefore used to hold the whole run
	 * open with no way out. Racing the interruption signal releases the runner so
	 * it can report `cancelled`; the abandoned tool still runs to completion in
	 * the background, but it no longer owns the run's lifetime.
	 */
	private async executeToolWithInterruption(execute: () => Promise<unknown>): Promise<unknown> {
		const signal = this.interruptionController?.signal
		const toolExecution = execute()
		if (!signal) return toolExecution
		if (signal.aborted) throw new SubagentToolInterruptedError()
		let onAbort: (() => void) | undefined
		try {
			return await Promise.race([
				toolExecution,
				new Promise<never>((_, reject) => {
					onAbort = () => reject(new SubagentToolInterruptedError())
					signal.addEventListener("abort", onAbort, { once: true })
				}),
			])
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort)
			// The abandoned tool keeps running; make sure it cannot surface as an
			// unhandled rejection after the runner has moved on.
			void Promise.resolve(toolExecution).catch(() => undefined)
		}
	}

	private async interruptActiveWork(action: "abort" | "finish"): Promise<void> {
		this.activeRetryAbortController?.abort()
		// Only an abort abandons an in-flight tool. `finish` is a cooperative
		// wind-down that still wants the current tool's result before steering the
		// next turn to attempt_completion.
		if (action === "abort") this.interruptionController?.abort()
		try {
			this.activeApiAbort?.()
		} catch (error) {
			Logger.error(`[SubagentRunner] failed to ${action} active API stream`, error)
		}

		if (this.activeCommandExecutions > 0 && !this.abortingCommands && this.baseConfig.callbacks.cancelRunningCommandTool) {
			this.abortingCommands = true
			try {
				await this.baseConfig.callbacks.cancelRunningCommandTool()
			} catch (error) {
				Logger.error(`[SubagentRunner] failed to ${action} running command execution`, error)
			} finally {
				this.abortingCommands = false
			}
		}
	}

	private shouldAbort(): boolean {
		return this.abortRequested || (this.options.inheritTaskAbort !== false && this.baseConfig.taskState.abort)
	}

	private async getWorkspaceMetadataEnvironmentBlock(): Promise<string | null> {
		try {
			const workspacesJson =
				(await this.baseConfig.workspaceManager?.buildWorkspacesJson()) ??
				JSON.stringify(
					{
						workspaces: {
							[this.baseConfig.cwd]: {
								hint: path.basename(this.baseConfig.cwd) || this.baseConfig.cwd,
							},
						},
					},
					null,
					2,
				)

			return `<environment_details>\n# Workspace Configuration\n${workspacesJson}\n</environment_details>`
		} catch (error) {
			Logger.warn("[SubagentRunner] Failed to build workspace metadata block", error)
			return null
		}
	}

	async run(prompt: string, onProgress: (update: SubagentProgressUpdate) => void): Promise<SubagentRunResult> {
		this.abortRequested = false
		this.finishRequested = undefined
		this.completionOnly = false
		this.running = true
		this.activeRetryAbortController = new AbortController()
		this.interruptionController = new AbortController()
		const state = new TaskState()
		let emptyAssistantResponseRetries = 0
		let invalidCompletionRetries = 0
		const contextState: SubagentContextState = {}
		const contextManager = new ContextManager()
		const usageState: SubagentUsageState = {
			currentRequest: createEmptyRequestUsageState(),
		}
		const stats: SubagentRunStats = {
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
			currency: "",
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
		}
		let activeHostedServerToolLifecycle: ServerToolLifecycle | undefined
		let activeProviderExecution: ProviderExecutionCompletion | undefined

		try {
			const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
			const api = this.apiHandler
			const outputBudget = resolveSubagentOutputBudget(this.baseConfig, this.agent.getConfiguredMaxOutputTokens())
			const promptWithBudget = buildSubagentOutputBudgetPrompt(prompt, outputBudget.outputTokens)
			this.activeApiAbort = api.abort?.bind(api)

			// Use handler's provider ID to avoid cross-task interference from global StateManager
			const providerId = api.getProviderId?.() ?? DEFAULT_API_PROVIDER
			const providerInfo = {
				providerId,
				model: api.getModel(),
				mode,
				customPrompt: this.baseConfig.services.stateManager.getGlobalSettingsKey("customPrompt"),
			}
			const webToolsEnabled =
				this.baseConfig.webToolsEnabled ??
				this.baseConfig.services.stateManager.getGlobalSettingsKey("clineWebToolsEnabled") === true
			const webSearchAllowed = this.allowedTools.includes(ClineDefaultTool.WEB_SEARCH)
			const webSearchRoutingPlan = resolveRequestWebSearchRoutingPlan(api, webToolsEnabled && webSearchAllowed)
			const completionWebSearchRoutingPlan = resolveRequestWebSearchRoutingPlan(api, false)
			stats.contextWindow = providerInfo.model.info.capabilities?.contextWindow || 0
			stats.currency = providerInfo.model.info.pricing?.currency || "USD"
			const apiFormat = providerInfo.model.info.apiFormats?.[0]
			const nativeToolCallsRequested =
				apiFormat === ApiFormat.OPENAI_RESPONSES ||
				apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE ||
				!!this.baseConfig.services.stateManager.getGlobalStateKey("nativeToolCallEnabled")
			const useNativeToolCalls = isNativeToolCallingConfig(providerInfo, nativeToolCallsRequested)
			const reasoning = this.agent.getReasoningConfig()
			onProgress({
				status: "running",
				runtime: {
					profileName: this.agent.getProfileName(),
					providerId,
					modelId: providerInfo.model.id,
					apiFormat: formatApiFormat(apiFormat),
					thinkingEnabled: reasoning?.enableThinking,
					reasoningEffort: reasoning?.effort,
					thinkingBudgetTokens: reasoning?.thinkingBudget,
				},
				stats: { ...stats },
			})

			const host = HostRegistryInfo.get()
			const remoteSkillEntries = this.baseConfig.services.stateManager.getRemoteConfigSettings().remoteGlobalSkills || []
			const availableSkills = await discoverAvailableSkills(this.baseConfig.cwd, {
				remoteSkillEntries,
				globalSkillsToggles: this.baseConfig.capabilityToggles.globalSkillsToggles,
				localSkillsToggles: this.baseConfig.capabilityToggles.localSkillsToggles,
				remoteSkillsToggles: this.baseConfig.capabilityToggles.remoteSkillsToggles,
			})
			const configuredSkillNames = this.agent.getConfiguredSkills()
			const skills =
				configuredSkillNames !== undefined
					? configuredSkillNames
							.map((skillName) => {
								const skill = availableSkills.find((candidate) => candidate.name === skillName)
								if (!skill) {
									Logger.warn(`[SubagentRunner] Configured skill '${skillName}' not found for subagent run.`)
								}
								return skill
							})
							.filter((skill): skill is (typeof availableSkills)[number] => Boolean(skill))
					: availableSkills

			const allowedTools = new Set(this.allowedTools)
			const context: SystemPromptContext = {
				providerInfo,
				promptProfile: resolvePromptProfile({
					modelId: providerInfo.model.id,
					contextWindow: providerInfo.model.info.capabilities?.contextWindow,
				}),
				cwd: this.baseConfig.cwd,
				ide: host?.platform || "Unknown",
				skills,
				focusChainSettings: this.baseConfig.focusChainSettings,
				browserSettings: this.baseConfig.browserSettings,
				yoloModeToggled: false,
				enableNativeToolCalls: useNativeToolCalls,
				enableParallelToolCalling: false,
				isSubagentRun: true,
				disableTools: Object.values(ClineDefaultTool).filter((tool) => !allowedTools.has(tool)),
				clineWebToolsEnabled: webToolsEnabled,
				webSearchRoutingPlan,
			}

			const generated = await getSystemPrompt(context)
			const systemPrompt = this.agent.buildSystemPrompt(generated.systemPrompt)
			const completionGenerated = await getSystemPrompt({
				...context,
				disableTools: Object.values(ClineDefaultTool).filter((tool) => tool !== ClineDefaultTool.ATTEMPT),
				clineWebToolsEnabled: false,
				webSearchRoutingPlan: undefined,
			})
			const completionSystemPrompt = this.agent.buildSystemPrompt(completionGenerated.systemPrompt)
			const nativeTools = generated.tools?.filter((tool) => {
				if ("function" in tool) {
					return allowedTools.has(tool.function.name as ClineDefaultTool)
				}
				if ("name" in tool && typeof tool.name === "string") {
					return allowedTools.has(tool.name as ClineDefaultTool)
				}
				return false
			})
			const completionNativeTools = nativeTools?.filter((tool) => {
				if ("function" in tool) return tool.function.name === ClineDefaultTool.ATTEMPT
				return "name" in tool && tool.name === ClineDefaultTool.ATTEMPT
			})
			const workspaceMetadataEnvironmentBlock = await this.getWorkspaceMetadataEnvironmentBlock()

			if (useNativeToolCalls && (!nativeTools || nativeTools.length === 0)) {
				const error = "Subagent tool requires native tool calling support."
				onProgress({ status: "failed", error, stats })
				return { status: "failed", error, stats }
			}

			if (this.shouldAbort()) {
				await this.abort()
				const error = "Subagent run cancelled."
				onProgress({ status: "cancelled", error, stats: { ...stats } })
				return { status: "cancelled", error, retryable: true, stats }
			}

			const finishProviderExecution = () => {
				activeProviderExecution?.finish()
				activeProviderExecution = undefined
			}
			const conversation: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: promptWithBudget,
						} as ClineTextContentBlock,
						// Server-side task loop checks require workspace metadata to be present in the
						// initial user message of subagent runs.
						...(workspaceMetadataEnvironmentBlock
							? [
									{
										type: "text",
										text: workspaceMetadataEnvironmentBlock,
									} as ClineTextContentBlock,
								]
							: []),
					],
				},
			]

			while (true) {
				finishProviderExecution()
				if (this.shouldAbort()) {
					await this.abort()
					const error = "Subagent run cancelled."
					onProgress({ status: "cancelled", error, stats: { ...stats } })
					return { status: "cancelled", error, retryable: true, stats }
				}
				if (this.finishRequested && !this.completionOnly) {
					this.completionOnly = true
					this.activeRetryAbortController = new AbortController()
					conversation.push({
						role: "user",
						content: [{ type: "text", text: buildFinishReminder(this.finishRequested) }],
					})
				}

				if (
					usageState.lastRequest &&
					this.shouldCompactBeforeNextRequest(usageState.lastRequest.totalTokens, api, providerInfo.model.id)
				) {
					const compactResult = this.compactConversationForContextWindow(
						contextManager,
						conversation,
						contextState.conversationHistoryDeletedRange,
					)
					contextState.conversationHistoryDeletedRange = compactResult.conversationHistoryDeletedRange
					if (compactResult.didCompact) {
						Logger.warn("[SubagentRunner] Proactively compacted context before next subagent request.")
					}
					// Prevent repeated compaction attempts off the same token sample.
					usageState.lastRequest = undefined
				}

				// Ephemeral ts factory for subagent internal parsing.
				// Uses Date.now() monotonic counter — subagent UI is not
				// rendered via main task presentation, so these ts values
				// only need to satisfy the ToolUse type contract.
				let ephemeralTs = Date.now()
				const streamHandler = new StreamResponseHandler(() => ++ephemeralTs)
				const { toolUseHandler } = streamHandler.getHandlers()
				usageState.currentRequest = createEmptyRequestUsageState()
				const requestUsage = usageState.currentRequest

				let assistantText = ""
				let assistantTextSignature: string | undefined
				let requestId: string | undefined
				const countedHostedServerToolIds = new Set<string>()
				const requestWebSearchRoutingPlan = this.completionOnly ? completionWebSearchRoutingPlan : webSearchRoutingPlan
				activeHostedServerToolLifecycle = new ServerToolLifecycle(requestWebSearchRoutingPlan, true, (update) => {
					if (!countedHostedServerToolIds.has(update.dlineTid)) {
						countedHostedServerToolIds.add(update.dlineTid)
						stats.toolCalls += 1
					}
					onProgress({
						stats: { ...stats },
						latestToolCall: "web_search",
						event:
							update.status === "completed" || update.status === "failed"
								? {
										kind: "tool_result",
										phase: "final",
										toolCallId: update.dlineTid,
										toolName: "web_search",
										toolStatus: update.status,
										error: update.error,
									}
								: {
										kind: "tool_call",
										phase: "delta",
										toolCallId: update.dlineTid,
										toolName: "web_search",
										toolStatus: "started",
									},
					})
				})

				const providerRequestRound = this.baseConfig.providerRequestRounds?.admit({ source: "subagent" })
				const providerExecution = new ProviderExecutionCompletion(providerRequestRound)
				activeProviderExecution = providerExecution
				const roundUsageAccumulator = new ApiUsageAccumulator()
				let roundUsageReported = false
				let roundCacheUsageReported = false
				let roundThoughtsTokens = 0
				let roundThoughtsReported = false
				let roundTotalCost: number | undefined
				const providerStream = this.createMessageWithInitialChunkRetry(
					api,
					this.completionOnly ? completionSystemPrompt : systemPrompt,
					conversation,
					this.completionOnly ? completionNativeTools : nativeTools,
					providerInfo.providerId,
					providerInfo.model.id,
					contextManager,
					contextState,
					requestWebSearchRoutingPlan,
					providerRequestRound,
					onProgress,
				)
				const stream = normalizeApiStream(providerStream, createStreamNormalizer(createIdentityFactory()))

				try {
					for await (const chunk of stream) {
						switch (chunk.type) {
							case "usage":
								requestId = requestId ?? chunk.provider_metadata?.response_id
								roundUsageReported = true
								roundCacheUsageReported ||=
									chunk.cacheWriteTokens !== undefined || chunk.cacheReadTokens !== undefined
								roundUsageAccumulator.apply(chunk)
								if (chunk.thoughtsTokenCount !== undefined) {
									roundThoughtsReported = true
									const thoughtsTokens = Math.max(0, Math.floor(chunk.thoughtsTokenCount))
									roundThoughtsTokens =
										chunk.usageMode === "delta"
											? roundThoughtsTokens + thoughtsTokens
											: Math.max(roundThoughtsTokens, thoughtsTokens)
								}
								if (chunk.totalCost !== undefined && Number.isFinite(chunk.totalCost) && chunk.totalCost >= 0) {
									roundTotalCost = Math.max(roundTotalCost ?? 0, chunk.totalCost)
								}
								stats.inputTokens += chunk.inputTokens || 0
								stats.outputTokens += chunk.outputTokens || 0
								stats.cacheWriteTokens += chunk.cacheWriteTokens || 0
								stats.cacheReadTokens += chunk.cacheReadTokens || 0
								requestUsage.inputTokens += chunk.inputTokens || 0
								requestUsage.outputTokens += chunk.outputTokens || 0
								requestUsage.cacheWriteTokens += chunk.cacheWriteTokens || 0
								requestUsage.cacheReadTokens += chunk.cacheReadTokens || 0
								requestUsage.totalTokens =
									requestUsage.inputTokens +
									requestUsage.outputTokens +
									requestUsage.cacheWriteTokens +
									requestUsage.cacheReadTokens
								requestUsage.totalCost = chunk.totalCost ?? requestUsage.totalCost
								stats.contextTokens = requestUsage.totalTokens
								stats.contextUsagePercentage =
									stats.contextWindow > 0 ? (stats.contextTokens / stats.contextWindow) * 100 : 0
								onProgress({ stats: { ...stats } })
								break
							case "text":
								requestId = requestId ?? chunk.provider_metadata?.response_id
								assistantText += chunk.text || ""
								assistantTextSignature = chunk.signature || assistantTextSignature
								if (chunk.text) {
									onProgress({ event: { kind: "assistant_message", phase: "delta", text: chunk.text } })
								}
								break
							case "tool_calls":
								requestId = requestId ?? chunk.provider_metadata?.response_id
								toolUseHandler.processToolUseDelta(
									{
										type: "tool_use",
										name: chunk.tool_call.function?.name,
										input: normalizeToolCallArguments(chunk.tool_call.function?.arguments),
										signature: chunk.signature,
									},
									{
										function_id: chunk.function_id,
										dline_tid: chunk.dline_tid,
										provider_metadata: chunk.provider_metadata,
									},
								)
								break
							case "server_tool": {
								requestId = requestId ?? chunk.provider_metadata?.response_id
								await activeHostedServerToolLifecycle.consume(chunk)
								break
							}
							case "reasoning":
								requestId = requestId ?? chunk.provider_metadata?.response_id
								if (chunk.reasoning) {
									onProgress({ event: { kind: "thinking", phase: "delta", text: chunk.reasoning } })
								}
								break
						}

						if (this.shouldAbort()) {
							await activeHostedServerToolLifecycle.finalizeOpen("Subagent hosted web search cancelled.")
							await this.abort()
							const error = "Subagent run cancelled."
							onProgress({ status: "cancelled", error, stats: { ...stats } })
							return { status: "cancelled", error, retryable: true, stats }
						}
					}
				} finally {
					if (roundUsageReported && providerRequestRound) {
						const roundUsage = roundUsageAccumulator.getUsage()
						const calculatedRoundCost =
							roundTotalCost ??
							calculateApiCostAnthropic(
								providerInfo.model.info,
								roundUsage.inputTokens,
								roundUsage.outputTokens,
								roundUsage.cacheWriteTokens,
								roundUsage.cacheReadTokens,
							)
						providerRequestRound.attachExactUsage({
							inputTokens: roundUsage.inputTokens,
							outputTokens: roundUsage.outputTokens,
							...(roundThoughtsReported ? { thoughtsTokens: roundThoughtsTokens } : {}),
							cacheWriteTokens: roundUsage.cacheWriteTokens,
							cacheReadTokens: roundUsage.cacheReadTokens,
							cacheUsageReported: roundCacheUsageReported,
							...(calculatedRoundCost === undefined ? {} : { totalCost: calculatedRoundCost }),
							currency: stats.currency || "USD",
						})
					}
				}
				await activeHostedServerToolLifecycle.finalizeOpen(
					"Provider stream ended before subagent hosted web search returned a result.",
				)

				const calculatedRequestCost =
					requestUsage.totalCost ??
					calculateApiCostAnthropic(
						providerInfo.model.info,
						requestUsage.inputTokens,
						requestUsage.outputTokens,
						requestUsage.cacheWriteTokens,
						requestUsage.cacheReadTokens,
					)
				requestUsage.totalTokens =
					requestUsage.inputTokens +
					requestUsage.outputTokens +
					requestUsage.cacheWriteTokens +
					requestUsage.cacheReadTokens
				stats.totalCost += calculatedRequestCost || 0
				usageState.lastRequest = { ...requestUsage }

				const nativeFinalizedToolCalls: SubagentToolCall[] = toolUseHandler.getAllFinalizedToolUses().map((toolCall) => {
					if (!toolCall.function_id || !toolCall.dline_tid) {
						throw new Error(`Canonical subagent tool call is missing identity: tool=${toolCall.name}`)
					}
					return {
						function_id: toolCall.function_id,
						dline_tid: toolCall.dline_tid,
						provider_metadata: toolCall.provider_metadata,
						signature: toolCall.signature,
						name: toolCall.name,
						input: toolCall.input,
						isNativeToolCall: true,
					}
				})
				const parsedNonNativeToolCalls = parseNonNativeToolCalls(assistantText)
				const fallbackNonNativeToolCalls = nativeFinalizedToolCalls.map((toolCall) => ({
					...toolCall,
					isNativeToolCall: false,
				}))

				let finalizedToolCalls: SubagentToolCall[] = []
				if (useNativeToolCalls) {
					finalizedToolCalls = nativeFinalizedToolCalls
				} else if (parsedNonNativeToolCalls.length > 0) {
					finalizedToolCalls = parsedNonNativeToolCalls
				} else if (fallbackNonNativeToolCalls.length > 0) {
					// Defensive fallback: if non-native mode receives structured tool call chunks,
					// execute them but serialize results as plain text to avoid tool_result pairing mismatches.
					Logger.warn(
						"[SubagentRunner] Received structured tool_calls while native tool calling is disabled; falling back to non-native result serialization.",
					)
					finalizedToolCalls = fallbackNonNativeToolCalls
				}
				providerExecution.setToolCount(finalizedToolCalls.length)
				if (this.finishRequested && !this.completionOnly) {
					const validCompletion = finalizedToolCalls.some((call) => {
						if (call.name !== ClineDefaultTool.ATTEMPT) return false
						return Boolean(toToolUseParams(call.input).result?.trim())
					})
					if (!validCompletion) {
						this.completionOnly = true
						this.activeRetryAbortController = new AbortController()
						conversation.push({
							role: "user",
							content: [{ type: "text", text: buildFinishReminder(this.finishRequested) }],
						})
						await Promise.resolve()
						continue
					}
				}

				const assistantContent: ClineAssistantContent[] = []
				if (assistantText.trim().length > 0) {
					onProgress({ event: { kind: "assistant_message", phase: "final", text: assistantText } })
					assistantContent.push({
						type: "text",
						text: assistantText,
						signature: assistantTextSignature,
					})
				}
				if (useNativeToolCalls) {
					assistantContent.push(...finalizedToolCalls.map(toAssistantToolUseBlock))
				}

				if (assistantContent.length > 0) {
					conversation.push({
						role: "assistant",
						content: assistantContent,
						provider_metadata: requestId ? { response_id: requestId } : undefined,
					})
				}

				if (finalizedToolCalls.length === 0) {
					emptyAssistantResponseRetries += 1
					if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
						const error = buildCompletionRequiredFailure()
						onProgress({ status: "failed", error, stats: { ...stats } })
						return { status: "failed", error, stats }
					}

					// Mirror the main loop's no-tools-used nudge so empty/blank model turns
					// can recover without surfacing an immediate hard failure in subagent UI.
					if (assistantContent.length === 0) {
						conversation.push({
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Failure: I did not provide a response.",
								},
							],
							provider_metadata: requestId ? { response_id: requestId } : undefined,
						})
					}
					conversation.push({
						role: "user",
						content: [
							{
								type: "text",
								text: buildCompletionRequiredReminder(useNativeToolCalls),
							},
						],
					})
					await Promise.resolve()
					continue
				}
				emptyAssistantResponseRetries = 0

				const toolResultBlocks = [] as ClineUserContent[]
				for (const call of finalizedToolCalls) {
					const toolName = call.name as ClineDefaultTool
					const toolCallParams = toToolUseParams(call.input)
					const toolCallBlock: ToolUse = {
						type: "tool_use",
						name: toolName,
						params: toolCallParams,
						partial: false,
						ts: Date.now(),
						isNativeToolCall: call.isNativeToolCall,
						function_id: call.function_id,
						dline_tid: call.dline_tid,
						signature: call.signature,
					}
					canonicalizeAttemptCompletionParams(toolCallBlock)

					if (this.completionOnly && toolName !== ClineDefaultTool.ATTEMPT) {
						providerExecution.failTool()
						invalidCompletionRetries += 1
						if (invalidCompletionRetries > MAX_INVALID_COMPLETION_RETRIES) {
							const error = buildInvalidCompletionFailure()
							onProgress({ status: "failed", error, stats: { ...stats } })
							return { status: "failed", error, stats }
						}
						pushSubagentToolResultBlock(
							toolResultBlocks,
							call,
							toolName,
							buildFinishReminder(this.finishRequested ?? "user"),
						)
						continue
					}

					if (toolName === ClineDefaultTool.ATTEMPT) {
						const completionResult = toolCallParams.result?.trim()
						if (!completionResult) {
							providerExecution.failTool()
							invalidCompletionRetries += 1
							if (invalidCompletionRetries > MAX_INVALID_COMPLETION_RETRIES) {
								const error = buildInvalidCompletionFailure()
								onProgress({ status: "failed", error, stats: { ...stats } })
								return { status: "failed", error, stats }
							}
							pushSubagentToolResultBlock(toolResultBlocks, call, toolName, buildMissingCompletionResultReminder())
							continue
						}

						const boundedCompletionResult = truncateTextToSubagentOutputBudget(
							completionResult,
							outputBudget.outputTokens,
						)
						const latestToolCall = formatToolCallPreview(toolName, toolCallParams)
						onProgress({
							latestToolCall,
							event: {
								kind: "tool_call",
								toolCallId: call.dline_tid,
								toolName,
								toolStatus: "completed",
								summary: latestToolCall,
							},
						})
						providerExecution.completeTool()
						stats.toolCalls += 1
						onProgress({ stats: { ...stats } })
						onProgress({ status: "completed", result: boundedCompletionResult, stats: { ...stats } })
						return { status: "completed", result: boundedCompletionResult, stats }
					}

					if (!this.allowedTools.includes(toolName)) {
						providerExecution.failTool()
						const deniedResult = formatResponse.toolError(`Tool '${toolName}' is not available inside subagent runs.`)
						pushSubagentToolResultBlock(toolResultBlocks, call, toolName, deniedResult)
						continue
					}

					const latestToolCall = formatToolCallPreview(toolName, toolCallParams)
					const toolStartedAt = Date.now()
					onProgress({
						latestToolCall,
						event: {
							kind: "tool_call",
							toolCallId: call.dline_tid,
							toolName,
							toolStatus: "started",
							summary: latestToolCall,
						},
					})

					const subagentConfig = this.createSubagentTaskConfig(state, webToolsEnabled, webSearchRoutingPlan)
					const handler = this.baseConfig.coordinator.getHandler(toolName)
					let toolResult: unknown
					let toolError: string | undefined

					if (!handler) {
						toolError = `No handler registered for tool '${toolName}'.`
						toolResult = formatResponse.toolError(toolError)
					} else {
						try {
							toolResult = await this.executeToolWithInterruption(() =>
								handler.execute(subagentConfig, toolCallBlock),
							)
						} catch (error) {
							// An interrupted wait is not a tool failure: fall through to the
							// abort check below so the run reports `cancelled`.
							if (error instanceof SubagentToolInterruptedError) {
								const cancelError = "Subagent run cancelled."
								onProgress({ status: "cancelled", error: cancelError, stats: { ...stats } })
								return { status: "cancelled", error: cancelError, retryable: true, stats }
							}
							toolError = error instanceof Error ? error.message : String(error)
							toolResult = formatResponse.toolError(toolError)
						}
					}

					stats.toolCalls += 1
					onProgress({ stats: { ...stats } })

					if (toolError) providerExecution.failTool()
					else providerExecution.completeTool()
					const serializedToolResult = serializeToolResult(toolResult)
					onProgress({
						event: {
							kind: "tool_call",
							toolCallId: call.dline_tid,
							toolName,
							toolStatus: toolError ? "failed" : "completed",
							summary: latestToolCall,
							durationMs: Date.now() - toolStartedAt,
							error: toolError,
						},
					})
					onProgress({
						event: {
							kind: "tool_result",
							toolCallId: call.dline_tid,
							toolName,
							text: toolError ? undefined : serializedToolResult,
							error: toolError,
						},
					})
					const toolDescription = handler?.getDescription(toolCallBlock) || `[${toolName}]`
					pushSubagentToolResultBlock(toolResultBlocks, call, toolDescription, serializedToolResult)

					// Check for abort after each tool execution to exit early
					if (this.shouldAbort()) {
						await this.abort()
						const error = "Subagent run cancelled."
						onProgress({ status: "cancelled", error, stats: { ...stats } })
						return { status: "cancelled", error, retryable: true, stats }
					}
				}

				conversation.push({
					role: "user",
					content: toolResultBlocks,
				})

				finishProviderExecution()
				await Promise.resolve()
			}
		} catch (error) {
			await activeHostedServerToolLifecycle?.finalizeOpen(
				this.shouldAbort()
					? "Subagent hosted web search cancelled."
					: "Provider stream failed before subagent hosted web search returned a result.",
			)
			if (this.shouldAbort()) {
				const cancelledError = "Subagent run cancelled."
				onProgress({ status: "cancelled", error: cancelledError, stats: { ...stats } })
				return { status: "cancelled", error: cancelledError, retryable: true, stats }
			}

			const errorText = (error as Error).message || "Subagent execution failed."
			const retryable = this.shouldRetryStreamError(
				error,
				this.apiHandler.getProviderId?.() ?? DEFAULT_API_PROVIDER,
				this.apiHandler.getModel().id,
			)
			Logger.error("[SubagentRunner] run failed", error)
			onProgress({ status: "failed", error: errorText, stats: { ...stats } })
			return { status: "failed", error: errorText, retryable, stats }
		} finally {
			activeProviderExecution?.finish()
			await activeHostedServerToolLifecycle?.finalizeOpen("Subagent hosted web search ended without a result.")
			this.activeApiAbort = undefined
			this.activeRetryAbortController = undefined
			this.interruptionController = undefined
			this.running = false
		}
	}

	private createSubagentTaskConfig(
		state: TaskState,
		webToolsEnabled: boolean,
		webSearchRoutingPlan: WebSearchRoutingPlan,
	): TaskConfig {
		const baseCallbacks = this.baseConfig.callbacks
		const coordinator = new ToolExecutorCoordinator()
		const validator = new ToolValidator(this.baseConfig.services.ignoreController)

		for (const tool of this.allowedTools) {
			coordinator.registerByName(tool, validator)
		}

		return {
			...this.baseConfig,
			api: this.apiHandler,
			coordinator,
			taskState: state,
			isSubagentExecution: true,
			webToolsEnabled,
			webSearchRoutingPlan,
			vscodeTerminalExecutionMode: "backgroundExec",
			callbacks: {
				...baseCallbacks,
				say: async () => undefined,
				sayAndCreateMissingParamError: async (_toolName, paramName) =>
					formatResponse.toolError(formatResponse.missingToolParameterError(paramName)),
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined, options) => {
					this.activeCommandExecutions += 1
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds, {
							...options,
							useBackgroundExecution: true,
							suppressUserInteraction: true,
						})
					} finally {
						this.activeCommandExecutions = Math.max(0, this.activeCommandExecutions - 1)
					}
				},
			},
		}
	}

	/**
	 * Decide whether one failed Provider stream attempt may be retried.
	 *
	 * The main Task loop treats Provider failures as retryable by default and
	 * only excludes account-level errors that cannot recover by waiting
	 * (see `getStreamRetryDecision`). Subagents previously used an enumerated
	 * allow-list instead, so any upstream code outside that list - for example
	 * `stream_read_error` or `upstream_error` - silently skipped the whole
	 * backoff sequence. This method now mirrors the main loop: deny-list only.
	 */
	private shouldRetryStreamError(error: unknown, providerId: string, modelId: string): boolean {
		// A cancelled run is not a provider failure and must not be replayed here.
		if (error instanceof Error && error.name === "AbortError") return false
		// The provider refused to continue generating; replaying repeats the same limit.
		if (isOutputLimitExceededError(error)) return false

		const raw = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : undefined
		const messageRecord =
			error instanceof Error
				? (() => {
						try {
							const parsed = JSON.parse(error.message) as unknown
							return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
						} catch {
							return undefined
						}
					})()
				: undefined
		const asRecord = (value: unknown): Record<string, unknown> | undefined =>
			value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
		const rawError = asRecord(raw?.error)
		const rawNestedError = asRecord(rawError?.error)
		const messageError = asRecord(messageRecord?.error)
		const messageNestedError = asRecord(messageError?.error)
		const parsedError = ClineError.transform(error, modelId, providerId)
		// Providers nest the transport status differently; probe the known shapes
		// so an auth classification can still be separated from a transient state.
		const status =
			raw?.status ??
			raw?.statusCode ??
			asRecord(raw?.response)?.status ??
			rawError?.status ??
			rawNestedError?.status ??
			messageRecord?.status ??
			messageRecord?.statusCode ??
			asRecord(messageRecord?.response)?.status ??
			messageError?.status ??
			messageNestedError?.status ??
			parsedError._error.status
		const numericStatus = typeof status === "number" ? status : Number(status)
		// 408/409/425 are transport-level request states that can accompany an auth
		// classification without meaning the credentials themselves are rejected.
		const isRetryableRequestStatus = numericStatus === 408 || numericStatus === 409 || numericStatus === 425

		// Deny-list: only account-level failures that cannot recover by waiting.
		const isNonRetryableError =
			parsedError.isErrorType(ClineErrorType.Balance) ||
			parsedError.isErrorType(ClineErrorType.SpendLimit) ||
			parsedError.isErrorType(ClineErrorType.QuotaExceeded) ||
			(parsedError.isErrorType(ClineErrorType.Auth) && !isRetryableRequestStatus)

		return !isNonRetryableError
	}

	private compactConversationForContextWindow(
		contextManager: ContextManager,
		conversation: ClineStorageMessage[],
		conversationHistoryDeletedRange: [number, number] | undefined,
	): {
		didCompact: boolean
		conversationHistoryDeletedRange: [number, number] | undefined
	} {
		const optimizationResult = this.optimizeConversationForContextWindow(contextManager, conversation)
		let didCompact = optimizationResult.didOptimize
		let updatedDeletedRange = conversationHistoryDeletedRange

		if (optimizationResult.didOptimize && !optimizationResult.needToTruncate) {
			return {
				didCompact: true,
				conversationHistoryDeletedRange: updatedDeletedRange,
			}
		}

		const deletedRange = contextManager.getNextTruncationRange(conversation, conversationHistoryDeletedRange, "quarter")
		if (deletedRange[1] < deletedRange[0]) {
			return {
				didCompact,
				conversationHistoryDeletedRange: updatedDeletedRange,
			}
		}

		if (
			conversationHistoryDeletedRange &&
			deletedRange[0] === conversationHistoryDeletedRange[0] &&
			deletedRange[1] === conversationHistoryDeletedRange[1]
		) {
			return {
				didCompact,
				conversationHistoryDeletedRange: updatedDeletedRange,
			}
		}

		updatedDeletedRange = deletedRange
		didCompact = true
		return {
			didCompact,
			conversationHistoryDeletedRange: updatedDeletedRange,
		}
	}

	private optimizeConversationForContextWindow(
		contextManager: ContextManager,
		conversation: ClineStorageMessage[],
	): {
		didOptimize: boolean
		needToTruncate: boolean
	} {
		const timestamp = Date.now()
		const optimizationResult = contextManager.attemptFileReadOptimizationInMemory(conversation, undefined, timestamp)
		if (!optimizationResult.anyContextUpdates) {
			return { didOptimize: false, needToTruncate: true }
		}

		const optimizedConversation = optimizationResult.optimizedConversationHistory.map(
			(message) => message as ClineStorageMessage,
		)
		conversation.splice(0, conversation.length, ...optimizedConversation)
		return { didOptimize: true, needToTruncate: optimizationResult.needToTruncate }
	}

	private shouldCompactBeforeNextRequest(
		requestTotalTokens: number,
		api: ReturnType<typeof buildApiHandler>,
		modelId: string,
	): boolean {
		const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
		const useAutoCondense = this.baseConfig.services.stateManager.getGlobalSettingsKey("useAutoCondense")
		if (useAutoCondense && isNextGenModelFamily(modelId)) {
			const thresholdTokens = computeCompactTrigger(contextWindow, computeSummarizeBudget(), {
				triggerPercent: this.baseConfig.services.stateManager.getGlobalSettingsKey("autoCondenseTriggerPercent"),
				minReserveTokens: this.baseConfig.services.stateManager.getGlobalSettingsKey("autoCondenseMinReserveTokens"),
				maxReserveTokens: this.baseConfig.services.stateManager.getGlobalSettingsKey("autoCondenseMaxReserveTokens"),
				maxContextTokens: this.baseConfig.services.stateManager.getGlobalSettingsKey("autoCondenseMaxContextTokens"),
			})
			return shouldCompactProjectedUsage(requestTotalTokens, thresholdTokens)
		}

		return requestTotalTokens >= maxAllowedSize
	}

	private async *createMessageWithInitialChunkRetry(
		api: ReturnType<typeof buildApiHandler>,
		systemPrompt: string,
		fullConversation: ClineStorageMessage[],
		nativeTools: ClineTool[] | undefined,
		providerId: string,
		modelId: string,
		contextManager: ContextManager,
		contextState: SubagentContextState,
		webSearchRoutingPlan: WebSearchRoutingPlan,
		providerRequestRound: ProviderRequestRoundAdmission | undefined,
		onProgress: (update: SubagentProgressUpdate) => void,
	) {
		let cumulativeRetryDelayMs = 0
		for (let attempt = 1; attempt <= MAX_INITIAL_STREAM_ATTEMPTS; attempt += 1) {
			const truncatedConversation = contextManager
				.getTruncatedMessages(fullConversation, contextState.conversationHistoryDeletedRange)
				.map((message) => message as ClineStorageMessage)
			const roundContext = {
				taskId: this.baseConfig.taskId,
				requestIndex: ++this.apiLogRequestIndex,
				provider: providerId,
				model: modelId,
				source: "subagent" as const,
			}
			await recordProviderAdapterInput(roundContext, {
				systemPrompt,
				messages: truncatedConversation,
				tools: nativeTools,
			})
			const providerStream = recordProviderAdapterOutput(
				roundContext,
				api.createMessage(systemPrompt, truncatedConversation, nativeTools, {
					serverTools: webSearchRoutingPlan.serverTools,
					retryOwner: "subagent",
				}),
			)
			const stream = providerRequestRound?.bindAttempt(providerStream, attempt - 1) ?? providerStream
			const iterator = stream[Symbol.asyncIterator]()
			const bufferedUsageChunks: Array<Extract<ApiProviderStreamChunk, { type: "usage" }>> = []
			let didYieldSemanticChunk = false

			try {
				while (true) {
					const nextChunk = await iterator.next()
					if (nextChunk.done) {
						for (const usageChunk of bufferedUsageChunks) yield usageChunk
						return
					}
					if (nextChunk.value.type === "usage") {
						bufferedUsageChunks.push(nextChunk.value)
						continue
					}

					didYieldSemanticChunk = true
					for (const usageChunk of bufferedUsageChunks) yield usageChunk
					yield nextChunk.value
					yield* { [Symbol.asyncIterator]: () => iterator }
					return
				}
			} catch (error) {
				if (this.finishRequested && !this.shouldAbort()) return

				// Usage-only prefixes are attempt-local accounting and remain replayable.
				// Once semantic output is observable, replay would duplicate content or tool lifecycles.
				if (didYieldSemanticChunk) {
					throw error
				}

				if (checkContextWindowExceededError(error)) {
					const compactResult = this.compactConversationForContextWindow(
						contextManager,
						fullConversation,
						contextState.conversationHistoryDeletedRange,
					)
					contextState.conversationHistoryDeletedRange = compactResult.conversationHistoryDeletedRange
					if (!compactResult.didCompact || this.shouldAbort() || attempt >= MAX_INITIAL_STREAM_ATTEMPTS) {
						throw error
					}
					Logger.warn(
						`[SubagentRunner] Context window exceeded on initial stream attempt ${attempt}; compacted conversation and retrying.`,
					)
					continue
				}

				const shouldRetry =
					!this.shouldAbort() &&
					attempt < MAX_INITIAL_STREAM_ATTEMPTS &&
					this.shouldRetryStreamError(error, providerId, modelId)
				if (!shouldRetry) {
					throw error
				}

				const delayMs = INITIAL_STREAM_RETRY_DELAYS_MS[attempt - 1]
				if (delayMs === undefined) throw error
				cumulativeRetryDelayMs += delayMs
				onProgress({
					event: {
						kind: "retry",
						retryAttempt: attempt,
						maxRetries: INITIAL_STREAM_RETRY_DELAYS_MS.length,
						delayMs,
						cumulativeDelayMs: cumulativeRetryDelayMs,
					},
				})
				Logger.warn(`[SubagentRunner] Initial stream failed. Retrying attempt ${attempt + 1} after ${delayMs}ms.`, error)
				try {
					await waitForSubagentRetry(delayMs, this.activeRetryAbortController?.signal)
				} catch (waitError) {
					if (this.finishRequested && !this.shouldAbort()) return
					throw waitError
				}
			}
		}
	}
}
