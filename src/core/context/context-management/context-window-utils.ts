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
export const COMPACTION_CLOSURE_RESERVE_TOKENS = 3_000
/**
 * Share of the compaction reserve a complete-range Pass probe may borrow.
 *
 * The trailing logical turn before compaction often overshoots the Pass ceiling by a small
 * margin. Splitting that range into an extra Pass strands most of the context window, which
 * is far worse than letting the turn encroach on part of the reserve.
 */
const COMPACTION_RESERVE_ENCROACHMENT_RATIO = 0.2

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
	effectiveContextLimitTokens: number
	hardPassContextWindowTokens: number
	projectedUsageTriggerTokens: number
	compactTriggerTokens: number
	/** Backward-compatible alias for the hard hidden-Pass context boundary. */
	passInputCeilingTokens: number
	/** Tokens a complete-range Pass probe may borrow from the reserve before splitting. */
	passInputCeilingAllowanceTokens: number
}

/**
 * Resolve how far a complete-range Pass probe may exceed the Pass ceiling.
 *
 * @param reserveTokens The reserve the encroachment ratio applies to.
 * @param hardPassContextWindowTokens The hard context boundary a Pass request must respect.
 * @param passInputCeilingTokens The strict Pass ceiling used for every other candidate.
 * @returns The allowance in tokens, never pushing a request past the hard context boundary.
 */
function resolvePassInputCeilingAllowance(
	reserveTokens: number,
	hardPassContextWindowTokens: number,
	passInputCeilingTokens: number,
): number {
	const requestedAllowance = Math.floor(Math.max(0, reserveTokens) * COMPACTION_RESERVE_ENCROACHMENT_RATIO)
	const availableHeadroom = Math.max(0, hardPassContextWindowTokens - passInputCeilingTokens - 1)
	return Math.min(requestedAllowance, availableHeadroom)
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
		const effectiveContextLimitTokens = maxContextTokens
		const hardPassContextWindowTokens = maxContextTokens
		const projectedUsageTriggerTokens = Math.max(
			0,
			effectiveContextLimitTokens - normalizedInstructionBudget - COMPACTION_CLOSURE_RESERVE_TOKENS,
		)
		const passInputCeilingTokens = Math.max(0, hardPassContextWindowTokens - COMPACTION_CLOSURE_RESERVE_TOKENS - 1)
		return {
			branch: "absolute_cap",
			guardedReserveTokens: 0,
			effectiveContextLimitTokens,
			hardPassContextWindowTokens,
			projectedUsageTriggerTokens,
			compactTriggerTokens: projectedUsageTriggerTokens + ESTIMATION_TOLERANCE,
			passInputCeilingTokens,
			passInputCeilingAllowanceTokens: resolvePassInputCeilingAllowance(
				COMPACTION_CLOSURE_RESERVE_TOKENS,
				hardPassContextWindowTokens,
				passInputCeilingTokens,
			),
		}
	}

	const triggerPercent = normalizeAutoCondenseTriggerPercent(options.triggerPercent)
	const percentageReserveTokens = Math.floor((normalizedContextWindow * (100 - triggerPercent)) / 100)
	const { minReserveTokens, maxReserveTokens } = normalizeAutoCondenseReservePair(
		options.minReserveTokens,
		options.maxReserveTokens,
	)
	const guardedReserveTokens = clampValue(percentageReserveTokens, minReserveTokens, maxReserveTokens)

	const effectiveContextLimitTokens = Math.max(0, normalizedContextWindow - guardedReserveTokens)
	const hardPassContextWindowTokens = normalizedContextWindow
	const projectedUsageTriggerTokens = Math.max(
		0,
		effectiveContextLimitTokens - normalizedInstructionBudget - COMPACTION_CLOSURE_RESERVE_TOKENS,
	)
	const passInputCeilingTokens = Math.max(0, hardPassContextWindowTokens - COMPACTION_CLOSURE_RESERVE_TOKENS - 1)
	return {
		branch: "percentage_guarded",
		guardedReserveTokens,
		effectiveContextLimitTokens,
		hardPassContextWindowTokens,
		projectedUsageTriggerTokens,
		compactTriggerTokens: projectedUsageTriggerTokens + ESTIMATION_TOLERANCE,
		passInputCeilingTokens,
		passInputCeilingAllowanceTokens: resolvePassInputCeilingAllowance(
			guardedReserveTokens,
			hardPassContextWindowTokens,
			passInputCeilingTokens,
		),
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
