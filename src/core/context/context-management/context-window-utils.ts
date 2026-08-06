import { ApiHandler } from "@core/api"
import { normalizeAutoCondenseMaxContextTokens, normalizeAutoCondenseTriggerPercent } from "@shared/auto-condense"

const SAFETY_BUFFER_RATIO = 0.03
const MIN_SAFETY_BUFFER = 5_000
const MAX_SAFETY_BUFFER = 30_000
const SUMMARIZE_INSTRUCTION_BUDGET = 2_500

export interface CompactTriggerOptions {
	triggerPercent?: number
	maxContextTokens?: number
}

/**
 * Clamp a numeric value between lower and upper bounds.
 *
 * @param value The candidate value to clamp.
 * @param lower The inclusive lower bound.
 * @param upper The inclusive upper bound.
 * @returns The clamped numeric value.
 */
function clampValue(value: number, lower: number, upper: number): number {
	return Math.min(Math.max(value, lower), upper)
}

/**
 * Compute the safety buffer reserved for summarize-task request overhead.
 *
 * @param contextWindow The raw input context window in tokens.
 * @returns The safety buffer, equal to 3% clamped to 5k..30k tokens.
 */
export function computeSafetyBuffer(contextWindow: number): number {
	return clampValue(Math.floor(contextWindow * SAFETY_BUFFER_RATIO), MIN_SAFETY_BUFFER, MAX_SAFETY_BUFFER)
}

/**
 * Compute the input-token budget for injected summarize_task instructions.
 *
 * @returns The fixed summarize-task instruction budget in input tokens.
 */
export function computeSummarizeBudget(): number {
	return SUMMARIZE_INSTRUCTION_BUDGET
}

/**
 * Compute the token threshold where proactive compaction should start.
 *
 * @param contextWindow The raw input context window in tokens.
 * @param summarizeInstructionBudget The injected summarize_task input budget in tokens.
 * @param options Optional user-configured percentage and absolute trigger cap.
 * @returns The earliest safe proactive compaction trigger token count.
 */
export function computeCompactTrigger(
	contextWindow: number,
	summarizeInstructionBudget: number,
	options: CompactTriggerOptions = {},
): number {
	const hardCeiling = contextWindow - summarizeInstructionBudget - computeSafetyBuffer(contextWindow)
	const percentagePoint =
		options.triggerPercent === undefined
			? Number.POSITIVE_INFINITY
			: Math.floor((contextWindow * normalizeAutoCondenseTriggerPercent(options.triggerPercent)) / 100)
	const maxContextTokens = normalizeAutoCondenseMaxContextTokens(options.maxContextTokens)
	const absolutePoint = maxContextTokens > 0 ? maxContextTokens : Number.POSITIVE_INFINITY

	return Math.max(Math.min(hardCeiling, percentagePoint, absolutePoint), 0)
}

/**
 * Computes the effective max allowed token count for a given context window size.
 * Pure computation — does NOT require an ApiHandler instance.
 *
 * @param contextWindow The raw context window size in tokens
 * @returns The max allowed size (contextWindow minus buffer)
 */
export function computeMaxAllowedSize(contextWindow: number): number {
	switch (contextWindow) {
		case 64_000: // deepseek models
			return contextWindow - 27_000
		case 128_000: // most models
			return contextWindow - 30_000
		case 200_000: // claude models
			return contextWindow - 40_000
		default:
			return Math.max(contextWindow - 40_000, contextWindow * 0.8)
	}
}

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	const contextWindow = api.getModel().info.capabilities?.contextWindow || 128_000
	const maxAllowedSize = computeMaxAllowedSize(contextWindow)

	return { contextWindow, maxAllowedSize }
}
