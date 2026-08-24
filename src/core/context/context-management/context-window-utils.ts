import { ApiHandler } from "@core/api"
import {
	DEFAULT_AUTO_CONDENSE_MAX_RESERVE_TOKENS,
	DEFAULT_AUTO_CONDENSE_MIN_RESERVE_TOKENS,
	normalizeAutoCondenseMaxContextTokens,
	normalizeAutoCondenseReservePair,
	normalizeAutoCondenseTriggerPercent,
} from "@shared/auto-condense"

const SAFETY_BUFFER_RATIO = 0.03
const SUMMARIZE_INSTRUCTION_BUDGET = 2_500
const ESTIMATION_TOLERANCE = 2_000

export interface CompactTriggerOptions {
	triggerPercent?: number
	minReserveTokens?: number
	maxReserveTokens?: number
	maxContextTokens?: number
}

export type CompactTriggerBranch = "percentage_guarded" | "absolute_cap"

export interface CompactTriggerPolicy {
	branch: CompactTriggerBranch
	guardedReserveTokens: number
	compactTriggerTokens: number
	passInputCeilingTokens: number
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
	return clampValue(
		Math.floor(contextWindow * SAFETY_BUFFER_RATIO),
		DEFAULT_AUTO_CONDENSE_MIN_RESERVE_TOKENS,
		DEFAULT_AUTO_CONDENSE_MAX_RESERVE_TOKENS,
	)
}

/**
 * Compute the input-token budget for injected summarize_task instructions.
 *
 * @returns The fixed summarize-task instruction budget in input tokens.
 */
export function computeSummarizeBudget(): number {
	return SUMMARIZE_INSTRUCTION_BUDGET
}

/** Return the fixed tolerance reserved for request-token estimation error. */
export function getEstimationTolerance(): number {
	return ESTIMATION_TOLERANCE
}

/** Decide whether projected usage reaches the proactive trigger after estimation tolerance. */
export function shouldCompactProjectedUsage(projectedUsage: number, triggerTokens: number): boolean {
	return projectedUsage + ESTIMATION_TOLERANCE >= triggerTokens
}

/** Resolve the single auto-condense trigger policy shared by every runtime consumer. */
export function resolveCompactTriggerPolicy(
	contextWindow: number,
	summarizeInstructionBudget: number,
	options: CompactTriggerOptions = {},
): CompactTriggerPolicy {
	const normalizedContextWindow = Math.max(0, Math.floor(contextWindow))
	const normalizedInstructionBudget = Math.max(0, Math.floor(summarizeInstructionBudget))
	const maxContextTokens = normalizeAutoCondenseMaxContextTokens(options.maxContextTokens)
	if (maxContextTokens > 0 && normalizedContextWindow > maxContextTokens) {
		return {
			branch: "absolute_cap",
			guardedReserveTokens: 0,
			compactTriggerTokens: maxContextTokens,
			passInputCeilingTokens: Math.max(0, maxContextTokens - ESTIMATION_TOLERANCE),
		}
	}

	const triggerPercent = normalizeAutoCondenseTriggerPercent(options.triggerPercent)
	const percentageReserveTokens = Math.floor((normalizedContextWindow * (100 - triggerPercent)) / 100)
	const { minReserveTokens, maxReserveTokens } = normalizeAutoCondenseReservePair(
		options.minReserveTokens,
		options.maxReserveTokens,
	)
	const guardedReserveTokens = clampValue(percentageReserveTokens, minReserveTokens, maxReserveTokens)

	return {
		branch: "percentage_guarded",
		guardedReserveTokens,
		compactTriggerTokens: Math.max(0, normalizedContextWindow - normalizedInstructionBudget - guardedReserveTokens),
		// The proactive trigger reserve decides when fitting starts; hidden Pass admission
		// uses the complete rendered request and leaves only estimation tolerance unused.
		passInputCeilingTokens: Math.max(0, normalizedContextWindow - ESTIMATION_TOLERANCE),
	}
}

/** Compute the token threshold where proactive compaction should start. */
export function computeCompactTrigger(
	contextWindow: number,
	summarizeInstructionBudget: number,
	options: CompactTriggerOptions = {},
): number {
	return resolveCompactTriggerPolicy(contextWindow, summarizeInstructionBudget, options).compactTriggerTokens
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
