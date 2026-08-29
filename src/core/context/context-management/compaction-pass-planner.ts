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
	passInputCeiling: number
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
		passInputCeiling,
		staticCosts,
		estimateExactInput,
	)
	if (
		exactCandidate.passEndTurnIndex === passStartTurnIndex &&
		exactCandidate.breakdown.combinedEstimatedInputTokens > passInputCeiling
	) {
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

async function selectExactCandidate(
	input: PlanNextCompactionPassInput,
	passStartTurnIndex: number,
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
	if (firstCombinedTokens > passInputCeiling || passStartTurnIndex === input.state.turns.length - 1) {
		return firstEstimate
	}

	let bestEstimate = firstEstimate
	let lowerEndTurnIndex = passStartTurnIndex + 1
	let upperEndTurnIndex = input.state.turns.length - 1
	let calibrationOffsetTokens = 0
	for (let attempt = 0; attempt < 4 && lowerEndTurnIndex <= upperEndTurnIndex; attempt++) {
		const approximateEndTurnIndex = findApproximatePassEnd(
			input.state,
			passStartTurnIndex,
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
	passInputCeiling: number,
	staticCosts: StaticPassCosts,
	tokenScale: number,
): number {
	let acceptedEndTurnIndex = passStartTurnIndex
	let low = passStartTurnIndex
	let high = state.turns.length - 1
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
