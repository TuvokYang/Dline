import cloneDeep from "clone-deep"
import type { ClineStorageMessage } from "@/shared/messages"
import { getEstimationTolerance } from "./context-window-utils"

export const COMPACTION_WINDOW_BUDGET_MARKER = "<compaction_window_budget />"

export interface CompactionWindowBudget {
	estimatedInputTokens: number
	availableRemainder: number
	outputHardLimit: number
	recommendedMin: number
	recommendedMax: number
}

export interface ResolveCompactionWindowBudgetInput {
	contextWindow: number
	maxOutputTokens?: number
	systemPrompt: string
	messages: ClineStorageMessage[]
	tools?: readonly unknown[]
	serverTools?: readonly unknown[]
}

export interface ResolvedCompactionWindowBudget {
	budget: CompactionWindowBudget
	messages: ClineStorageMessage[]
}

const TOKEN_ESTIMATE_BYTES = 4
const MAX_RENDER_PASSES = 3

/** Detect whether a request still contains a compaction-budget marker. */
export function hasCompactionWindowBudgetMarker(messages: readonly ClineStorageMessage[]): boolean {
	return messages.some((message) => JSON.stringify(message.content).includes(COMPACTION_WINDOW_BUDGET_MARKER))
}

/** Resolve a request-scoped compaction budget without mutating canonical history. */
export function resolveCompactionWindowBudget(input: ResolveCompactionWindowBudgetInput): ResolvedCompactionWindowBudget {
	let messages = cloneDeep(input.messages)
	let budget = computeBudget(input, messages)

	for (let pass = 0; pass < MAX_RENDER_PASSES; pass++) {
		const guidance = renderBudgetGuidance(budget)
		messages = replaceBudgetMarker(input.messages, guidance)
		const nextBudget = computeBudget(input, messages)
		if (
			nextBudget.estimatedInputTokens === budget.estimatedInputTokens &&
			nextBudget.outputHardLimit === budget.outputHardLimit
		) {
			budget = nextBudget
			break
		}
		budget = nextBudget
	}

	messages = replaceBudgetMarker(input.messages, renderBudgetGuidance(budget))
	budget = computeBudget(input, messages)
	return { budget, messages }
}

function computeBudget(input: ResolveCompactionWindowBudgetInput, messages: ClineStorageMessage[]): CompactionWindowBudget {
	const estimatedInputTokens = estimateTokens({
		systemPrompt: input.systemPrompt,
		messages,
		tools: input.tools ?? [],
		serverTools: input.serverTools ?? [],
	})
	const availableRemainder = Math.max(0, Math.floor(input.contextWindow) - estimatedInputTokens - getEstimationTolerance())
	const declaredMaxOutput = normalizePositiveInteger(input.maxOutputTokens)
	const outputHardLimit =
		availableRemainder > 0
			? declaredMaxOutput === undefined
				? availableRemainder
				: Math.min(availableRemainder, declaredMaxOutput)
			: (declaredMaxOutput ?? getEstimationTolerance())
	const recommendedMin = Math.min(Math.floor(availableRemainder * 0.8), 5_000)
	const recommendedMax = Math.min(Math.floor(availableRemainder * 0.9), 20_000)

	return {
		estimatedInputTokens,
		availableRemainder,
		outputHardLimit,
		recommendedMin,
		recommendedMax,
	}
}

function estimateTokens(value: unknown): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / TOKEN_ESTIMATE_BYTES))
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function replaceBudgetMarker(messages: ClineStorageMessage[], guidance: string): ClineStorageMessage[] {
	const cloned = cloneDeep(messages)
	for (const message of cloned) {
		if (typeof message.content === "string") {
			message.content = message.content.replaceAll(COMPACTION_WINDOW_BUDGET_MARKER, guidance)
			continue
		}
		for (const block of message.content) {
			if (block.type === "text") {
				block.text = block.text.replaceAll(COMPACTION_WINDOW_BUDGET_MARKER, guidance)
				continue
			}
			if (block.type !== "tool_result" || !block.content) {
				continue
			}
			if (typeof block.content === "string") {
				block.content = block.content.replaceAll(COMPACTION_WINDOW_BUDGET_MARKER, guidance)
				continue
			}
			for (const contentBlock of block.content) {
				if (contentBlock.type === "text") {
					contentBlock.text = contentBlock.text.replaceAll(COMPACTION_WINDOW_BUDGET_MARKER, guidance)
				}
			}
		}
	}
	return cloned
}

function renderBudgetGuidance(budget: CompactionWindowBudget): string {
	return `# Compaction Window Budget
- Estimated available context-window remainder: ${budget.availableRemainder} tokens.
- Hard limit for the complete response: ${budget.outputHardLimit} tokens.
- Recommended total response range: ${budget.recommendedMin}–${budget.recommendedMax} tokens.

The recommended range is guidance, not a quota or a minimum output requirement.
Do not expand the analysis or summary merely to fill the available range.
Preserve all information required to continue the task accurately and completely.
The complete response, including reasoning and the compaction tool-call payload, must not exceed the hard limit above.`
}
