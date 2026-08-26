import type { ClineStorageMessage } from "@/shared/messages"
import { COMPACTION_CLOSURE_RESERVE_TOKENS } from "./context-window-utils"

export type CompactionWindowBudgetDecision = "ready" | "needs_smaller_input"

export interface CompactionWindowBudget {
	estimatedInputTokens: number
	rawRemainder: number
	availableRemainder: number
	providerOutputCap: number
	closureReserveTokens: number
	reservedRequestTokens: number
	/** Backward-compatible prompt-facing alias for providerOutputCap. */
	outputHardLimit: number
	recommendedMin: number
	recommendedMax: number
	decision: CompactionWindowBudgetDecision
}

export interface ResolveCompactionWindowBudgetInput {
	contextWindow: number
	maxOutputTokens?: number
	systemPrompt: string
	tools?: readonly unknown[]
	serverTools?: readonly unknown[]
	closureReserveTokens?: number
	buildMessages: (guidance: string) => ClineStorageMessage[]
}

export interface ResolvedCompactionWindowBudget {
	budget: CompactionWindowBudget
	messages: ClineStorageMessage[]
}

const TOKEN_ESTIMATE_BYTES = 4
const MAX_RENDER_PASSES = 3

/** Resolve a request-scoped compaction budget by rebuilding only the explicit summarize_task instruction. */
export function resolveCompactionWindowBudget(input: ResolveCompactionWindowBudgetInput): ResolvedCompactionWindowBudget {
	let messages = input.buildMessages("")
	let budget = computeBudget(input, messages)

	for (let pass = 0; pass < MAX_RENDER_PASSES; pass++) {
		messages = input.buildMessages(renderBudgetGuidance(budget))
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

	messages = input.buildMessages(renderBudgetGuidance(budget))
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
	const rawRemainder = Math.floor(input.contextWindow) - estimatedInputTokens
	const availableRemainder = Math.max(0, rawRemainder)
	const closureReserveTokens = normalizeNonNegativeInteger(input.closureReserveTokens ?? COMPACTION_CLOSURE_RESERVE_TOKENS)
	const modelOutputLimit =
		typeof input.maxOutputTokens === "number" && Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0
			? Math.floor(input.maxOutputTokens)
			: availableRemainder
	const providerOutputCap = Math.min(
		modelOutputLimit,
		Math.floor(availableRemainder * 0.9),
		Math.max(0, availableRemainder - closureReserveTokens),
	)
	const recommendedMax = Math.min(Math.floor(availableRemainder * 0.9), 30_000, providerOutputCap)
	const recommendedMin = Math.min(Math.floor(availableRemainder * 0.8), 5_000, recommendedMax)
	const reservedRequestTokens = estimatedInputTokens + providerOutputCap + closureReserveTokens

	return {
		estimatedInputTokens,
		rawRemainder,
		availableRemainder,
		providerOutputCap,
		closureReserveTokens,
		reservedRequestTokens,
		outputHardLimit: providerOutputCap,
		recommendedMin,
		recommendedMax,
		decision: providerOutputCap > 0 ? "ready" : "needs_smaller_input",
	}
}

function normalizeNonNegativeInteger(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function estimateTokens(value: unknown): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / TOKEN_ESTIMATE_BYTES))
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
