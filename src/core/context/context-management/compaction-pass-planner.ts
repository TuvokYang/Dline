import type { ClineStorageMessage } from "@shared/messages/content"
import { hashCompactionValue } from "./compaction-hash"
import { estimateCompactionSourceRangeTokens } from "./compaction-source-snapshot"
import { getEstimationTolerance } from "./context-window-utils"
import {
	buildCompactionPassHistoryForRange,
	type CompactionPassIdentity,
	createCompactionPassRangeIdentity,
	type TargetWindowFittingState,
} from "./target-window-fitting"

export interface CompactionPassEstimateBreakdown {
	requestEnvelopeTokens: number
	summaryCarryTokens: number
	turnTokens: number
	combinedEstimatedInputTokens: number
	passInputCeiling: number
}

export interface CompactionPassPlan extends CompactionPassIdentity, CompactionPassEstimateBreakdown {
	estimatedInputTokens: number
	passHistoryHash: string
	candidateEstimateCount: number
	nextPassSummaryCarryLimitTokens?: number
}

export type CompactionPassEstimatePurpose = "request_envelope" | "summary_carry" | "final_candidate"

export interface PlanNextCompactionPassInput {
	state: TargetWindowFittingState
	/**
	 * Maximum estimated input one Pass request may carry.
	 *
	 * The caller resolves this from the compaction trigger plus the reserve concession, so the
	 * ceiling already accounts for the tokens a complete range is allowed to borrow. The planner
	 * applies it uniformly and never maintains a second, looser bound.
	 */
	passInputCeiling: number
	/**
	 * Highest logical turn index this Pass may still cover.
	 *
	 * The send side measures the built request independently of the planner's ceiling, so a refused
	 * range has to be narrowed by range rather than by estimate. Clamping the search space is the
	 * only signal that shrinks monotonically regardless of how the two sides measure tokens.
	 */
	maxEndTurnIndex?: number
	estimateInputTokens(
		messages: readonly ClineStorageMessage[],
		purpose?: CompactionPassEstimatePurpose,
	): number | Promise<number>
}

export type PlanNextCompactionPassResult =
	| { kind: "planned"; plan: CompactionPassPlan; passHistory: ClineStorageMessage[] }
	| ({ kind: "summary_carry_overflow"; turnIndex: number; candidateEstimateCount: number } & CompactionPassEstimateBreakdown)
	| ({ kind: "single_turn_overflow"; turnIndex: number; candidateEstimateCount: number } & CompactionPassEstimateBreakdown)

/** Select the maximal contiguous complete-turn batch that fits the full hidden request ceiling. */
export async function planNextCompactionPass(input: PlanNextCompactionPassInput): Promise<PlanNextCompactionPassResult> {
	const passInputCeiling = normalizeTokenCount(input.passInputCeiling)
	const passStartTurnIndex = input.state.coveredTurnCount
	if (passStartTurnIndex >= input.state.turns.length) {
		throw new Error("No uncovered logical turn is available for the next compaction Pass")
	}
	const maxEndTurnIndex = resolveMaxEndTurnIndex(input, passStartTurnIndex)

	let candidateEstimateCount = 0
	const estimateExactInput = async (
		messages: readonly ClineStorageMessage[],
		purpose: CompactionPassEstimatePurpose,
	): Promise<number> => {
		candidateEstimateCount += 1
		return normalizeTokenCount(await input.estimateInputTokens(messages, purpose))
	}
	const staticCosts = await estimateStaticPassCosts(input, estimateExactInput)
	const exactCandidate = await selectExactCandidate(
		input,
		passStartTurnIndex,
		maxEndTurnIndex,
		passInputCeiling,
		staticCosts,
		estimateExactInput,
	)
	const isSingleTurnPass = exactCandidate.passEndTurnIndex === passStartTurnIndex
	if (isSingleTurnPass && exactCandidate.breakdown.combinedEstimatedInputTokens > passInputCeiling) {
		const turnFitsWithoutSummary =
			exactCandidate.breakdown.requestEnvelopeTokens + exactCandidate.breakdown.turnTokens <= passInputCeiling
		return {
			kind:
				exactCandidate.breakdown.summaryCarryTokens > 0 && turnFitsWithoutSummary
					? "summary_carry_overflow"
					: "single_turn_overflow",
			turnIndex: passStartTurnIndex,
			candidateEstimateCount,
			...exactCandidate.breakdown,
		}
	}
	if (exactCandidate.breakdown.combinedEstimatedInputTokens > passInputCeiling) {
		throw new Error("Unable to find a fitting compaction Pass after bounded exact candidate calibration")
	}
	const acceptedEndIndex = exactCandidate.passEndTurnIndex
	const acceptedEstimate = exactCandidate

	const rangeIdentity = createCompactionPassRangeIdentity(input.state, passStartTurnIndex, acceptedEndIndex)
	const nextPassSummaryCarryLimitTokens = estimateNextPassSummaryCarryLimit(
		input.state,
		acceptedEndIndex,
		passInputCeiling,
		staticCosts.requestEnvelopeTokens,
		acceptedEstimate.tokenScale,
	)
	return {
		kind: "planned",
		plan: {
			operationId: input.state.operationId,
			passIndex: input.state.passIndex,
			passStartTurnIndex,
			passEndTurnIndex: acceptedEndIndex,
			coveredTurnCount: input.state.coveredTurnCount,
			summaryBaselineHash: input.state.summaryBaselineHash,
			...rangeIdentity,
			...acceptedEstimate.breakdown,
			estimatedInputTokens: acceptedEstimate.breakdown.combinedEstimatedInputTokens,
			passHistoryHash: hashPassHistory(acceptedEstimate.passHistory),
			candidateEstimateCount,
			...(nextPassSummaryCarryLimitTokens === undefined ? {} : { nextPassSummaryCarryLimitTokens }),
		},
		passHistory: acceptedEstimate.passHistory,
	}
}

interface RangeEstimate {
	passEndTurnIndex: number
	passHistory: ClineStorageMessage[]
	breakdown: CompactionPassEstimateBreakdown
	tokenScale: number
}

interface StaticPassCosts {
	requestEnvelopeTokens: number
	summaryCarryTokens: number
}

async function estimateStaticPassCosts(
	input: PlanNextCompactionPassInput,
	estimateExactInput: (messages: readonly ClineStorageMessage[], purpose: CompactionPassEstimatePurpose) => Promise<number>,
): Promise<StaticPassCosts> {
	const requestEnvelopeTokens = await estimateExactInput([], "request_envelope")
	if (!input.state.cumulativeSummary) return { requestEnvelopeTokens, summaryCarryTokens: 0 }
	const summaryOnlyEstimatedInputTokens = await estimateExactInput(
		[summaryMessage(input.state.cumulativeSummary)],
		"summary_carry",
	)
	return {
		requestEnvelopeTokens,
		summaryCarryTokens: Math.max(0, summaryOnlyEstimatedInputTokens - requestEnvelopeTokens),
	}
}

/**
 * Clamp the search space to the turns this Pass is still allowed to cover.
 *
 * The first uncovered turn always remains available: a Pass that covers nothing would leave the
 * fitting loop without progress, and an unfittable single turn is reported as its own outcome.
 */
function resolveMaxEndTurnIndex(input: PlanNextCompactionPassInput, passStartTurnIndex: number): number {
	const lastTurnIndex = input.state.turns.length - 1
	if (input.maxEndTurnIndex === undefined) return lastTurnIndex
	return Math.min(lastTurnIndex, Math.max(passStartTurnIndex, input.maxEndTurnIndex))
}

async function selectExactCandidate(
	input: PlanNextCompactionPassInput,
	passStartTurnIndex: number,
	maxEndTurnIndex: number,
	passInputCeiling: number,
	staticCosts: StaticPassCosts,
	estimateExactInput: (messages: readonly ClineStorageMessage[], purpose: CompactionPassEstimatePurpose) => Promise<number>,
): Promise<RangeEstimate> {
	const firstTurn = input.state.turns[passStartTurnIndex]
	if (!firstTurn) throw new Error("Compaction Pass has no first uncovered logical turn")
	const firstPassHistory = buildCompactionPassHistoryForRange(input.state, passStartTurnIndex, passStartTurnIndex)
	const firstCombinedTokens = await estimateExactInput(firstPassHistory, "final_candidate")
	const firstBreakdown = createBreakdown(firstCombinedTokens, passInputCeiling, staticCosts)
	const firstRawTurnTokens = estimateCompactionSourceRangeTokens(
		input.state.sourceSnapshot,
		firstTurn.startMessageIndex,
		firstTurn.endMessageIndex,
	)
	const tokenScale = firstRawTurnTokens > 0 ? firstBreakdown.turnTokens / firstRawTurnTokens : 1
	const firstEstimate = {
		passEndTurnIndex: passStartTurnIndex,
		passHistory: firstPassHistory,
		breakdown: firstBreakdown,
		tokenScale,
	}
	if (firstCombinedTokens > passInputCeiling || passStartTurnIndex === maxEndTurnIndex) {
		return firstEstimate
	}

	// Probe the complete uncovered range before any extrapolation. The calibration
	// loop below scales from a single turn, so a locally expensive first turn can
	// project the whole range as oversized and permanently lower the search bound.
	// That split a conversation which fits in one Pass into several Passes and made
	// the first post-compaction request carry far less context than the window allows.
	const fullEndTurnIndex = maxEndTurnIndex
	const fullPassHistory = buildCompactionPassHistoryForRange(input.state, passStartTurnIndex, fullEndTurnIndex)
	const fullCombinedTokens = await estimateExactInput(fullPassHistory, "final_candidate")
	// The ceiling already includes the reserve concession, so a complete range that fits it is
	// always sent as one request. Splitting here would strand a large part of the window and
	// force the excluded tail to be replayed as a fresh prefix after compaction.
	if (fullCombinedTokens <= passInputCeiling) {
		return {
			passEndTurnIndex: fullEndTurnIndex,
			passHistory: fullPassHistory,
			breakdown: createBreakdown(fullCombinedTokens, passInputCeiling, staticCosts),
			tokenScale,
		}
	}

	let bestEstimate = firstEstimate
	let lowerEndTurnIndex = passStartTurnIndex + 1
	let upperEndTurnIndex = maxEndTurnIndex
	let calibrationOffsetTokens = 0
	for (let attempt = 0; attempt < 4 && lowerEndTurnIndex <= upperEndTurnIndex; attempt++) {
		const approximateEndTurnIndex = findApproximatePassEnd(
			input.state,
			passStartTurnIndex,
			maxEndTurnIndex,
			passInputCeiling - calibrationOffsetTokens,
			staticCosts,
			tokenScale,
		)
		const passEndTurnIndex = Math.min(upperEndTurnIndex, Math.max(lowerEndTurnIndex, approximateEndTurnIndex))
		const passHistory = buildCompactionPassHistoryForRange(input.state, passStartTurnIndex, passEndTurnIndex)
		const combinedEstimatedInputTokens = await estimateExactInput(passHistory, "final_candidate")
		const breakdown = createBreakdown(combinedEstimatedInputTokens, passInputCeiling, staticCosts)
		const estimate = { passEndTurnIndex, passHistory, breakdown, tokenScale }
		const approximateTokens = approximateCombinedTokens(
			input.state,
			passStartTurnIndex,
			passEndTurnIndex,
			staticCosts,
			tokenScale,
		)
		calibrationOffsetTokens += combinedEstimatedInputTokens - approximateTokens
		if (combinedEstimatedInputTokens <= passInputCeiling) {
			bestEstimate = estimate
			lowerEndTurnIndex = passEndTurnIndex + 1
		} else {
			upperEndTurnIndex = passEndTurnIndex - 1
		}
	}
	return bestEstimate
}

function findApproximatePassEnd(
	state: TargetWindowFittingState,
	passStartTurnIndex: number,
	maxEndTurnIndex: number,
	passInputCeiling: number,
	staticCosts: StaticPassCosts,
	tokenScale: number,
): number {
	let acceptedEndTurnIndex = passStartTurnIndex
	let low = passStartTurnIndex
	let high = maxEndTurnIndex
	while (low <= high) {
		const midpoint = Math.floor((low + high) / 2)
		if (approximateCombinedTokens(state, passStartTurnIndex, midpoint, staticCosts, tokenScale) <= passInputCeiling) {
			acceptedEndTurnIndex = midpoint
			low = midpoint + 1
		} else {
			high = midpoint - 1
		}
	}
	return acceptedEndTurnIndex
}

function approximateCombinedTokens(
	state: TargetWindowFittingState,
	passStartTurnIndex: number,
	passEndTurnIndex: number,
	staticCosts: StaticPassCosts,
	tokenScale: number,
): number {
	const firstTurn = state.turns[passStartTurnIndex]
	const lastTurn = state.turns[passEndTurnIndex]
	if (!firstTurn || !lastTurn) throw new Error("Compaction Pass has an invalid approximate turn range")
	return (
		staticCosts.requestEnvelopeTokens +
		staticCosts.summaryCarryTokens +
		Math.ceil(
			estimateCompactionSourceRangeTokens(state.sourceSnapshot, firstTurn.startMessageIndex, lastTurn.endMessageIndex) *
				tokenScale,
		)
	)
}

function createBreakdown(
	combinedEstimatedInputTokens: number,
	passInputCeiling: number,
	staticCosts: StaticPassCosts,
): CompactionPassEstimateBreakdown {
	const requestEnvelopeTokens = Math.min(staticCosts.requestEnvelopeTokens, combinedEstimatedInputTokens)
	const summaryCarryTokens = Math.min(
		staticCosts.summaryCarryTokens,
		Math.max(0, combinedEstimatedInputTokens - requestEnvelopeTokens),
	)
	return {
		requestEnvelopeTokens,
		summaryCarryTokens,
		turnTokens: Math.max(0, combinedEstimatedInputTokens - requestEnvelopeTokens - summaryCarryTokens),
		combinedEstimatedInputTokens,
		passInputCeiling,
	}
}

function estimateNextPassSummaryCarryLimit(
	state: TargetWindowFittingState,
	acceptedEndTurnIndex: number,
	passInputCeiling: number,
	requestEnvelopeTokens: number,
	tokenScale: number,
): number | undefined {
	const nextTurn = state.turns[acceptedEndTurnIndex + 1]
	if (!nextTurn) return undefined
	const nextTurnTokens = Math.ceil(
		estimateCompactionSourceRangeTokens(state.sourceSnapshot, nextTurn.startMessageIndex, nextTurn.endMessageIndex) *
			tokenScale,
	)
	return Math.max(0, passInputCeiling - requestEnvelopeTokens - nextTurnTokens - getEstimationTolerance())
}

function normalizeTokenCount(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function hashPassHistory(history: readonly ClineStorageMessage[]): string {
	return hashCompactionValue(history)
}

function summaryMessage(summary: string): ClineStorageMessage {
	return {
		role: "user",
		content: [{ type: "text", text: summary }],
	}
}
