import type { ClineStorageMessage } from "@shared/messages/content"
import cloneDeep from "clone-deep"
import type { CanonicalMessageRange } from "./compaction-context-projection"
import { hashCompactionSummary, hashCompactionValue } from "./compaction-hash"
import type { LogicalTurn, LogicalTurnIndex } from "./logical-turns"

export interface CompactionPassIdentity {
	operationId: string
	passIndex: number
	passStartTurnIndex: number
	passEndTurnIndex: number
	coveredTurnCount: number
	summaryBaselineHash: string
	/** Hash of the immutable source-message baseline indexed for this operation. */
	sourceHistoryHash?: string
	/** Inclusive coordinates in the immutable source-message baseline. */
	passStartMessageIndex?: number
	passEndMessageIndex?: number
	/** Hash binding the source baseline to both Pass coordinate systems and exact source messages. */
	rangeHash?: string
	passHistoryHash?: string
}

export interface CompactionPassSelection extends CompactionPassIdentity {
	estimatedInputTokens: number
	passInputCeiling: number
	passHistoryHash: string
}

export interface TargetWindowFittingState extends CompactionPassIdentity {
	sourceHistoryHash?: string
	passStartMessageIndex?: number
	passEndMessageIndex?: number
	sourceHistory: ClineStorageMessage[]
	sourceCanonicalRanges?: Array<CanonicalMessageRange | undefined>
	turns: LogicalTurn[]
	protectedTail: ClineStorageMessage[]
	cumulativeSummary?: string
	estimatedInputTokens?: number
	passInputCeiling?: number
	passHistoryHash?: string
	passPlanned: boolean
}

export interface AcceptedCompactionPass {
	state: TargetWindowFittingState
	coveredTurnCount: number
	hasMoreTurns: boolean
}

/** Start rolling fitting only when canonical history contains a complete logical turn. */
export function tryStartTargetWindowFitting(
	index: LogicalTurnIndex,
	operationId: string,
	sourceCanonicalRanges: readonly (CanonicalMessageRange | undefined)[] = [],
): TargetWindowFittingState | undefined {
	return index.turns.length === 0 ? undefined : startTargetWindowFitting(index, operationId, sourceCanonicalRanges)
}

/** Start fitting from the earliest complete logical turn. */
export function startTargetWindowFitting(
	index: LogicalTurnIndex,
	operationId: string,
	sourceCanonicalRanges: readonly (CanonicalMessageRange | undefined)[] = [],
): TargetWindowFittingState {
	if (index.turns.length === 0) {
		throw new Error("No complete logical turn is available for compaction")
	}
	if (!operationId.trim()) {
		throw new Error("Compaction operation ID must be non-empty")
	}
	const sourceHistory = [...index.turns.flatMap((turn) => cloneDeep(turn.messages)), ...cloneDeep(index.protectedTail)]
	if (sourceCanonicalRanges.length > 0 && sourceCanonicalRanges.length !== sourceHistory.length) {
		throw new Error("Compaction source canonical range mapping must align with source history")
	}
	return {
		operationId,
		passIndex: 0,
		summaryBaselineHash: hashSummaryBaseline(""),
		sourceHistoryHash: hashJsonValue(sourceHistory),
		sourceHistory,
		sourceCanonicalRanges:
			sourceCanonicalRanges.length > 0 ? cloneDeep([...sourceCanonicalRanges]) : sourceHistory.map(() => undefined),
		turns: cloneDeep(index.turns),
		protectedTail: cloneDeep(index.protectedTail),
		coveredTurnCount: 0,
		passStartTurnIndex: 0,
		passEndTurnIndex: -1,
		passStartMessageIndex: 0,
		passEndMessageIndex: -1,
		passPlanned: false,
	}
}

/** Apply one immutable planner result without advancing accepted logical-turn coverage. */
export function applyCompactionPassPlan(
	state: TargetWindowFittingState,
	plan: CompactionPassSelection,
): TargetWindowFittingState {
	if (plan.operationId !== state.operationId || plan.passIndex !== state.passIndex) {
		throw new Error("Compaction Pass plan does not belong to the active operation and Pass")
	}
	if (plan.coveredTurnCount !== state.coveredTurnCount || plan.passStartTurnIndex !== state.coveredTurnCount) {
		throw new Error("Compaction Pass plan does not start at the earliest uncovered logical turn")
	}
	if (plan.passEndTurnIndex < plan.passStartTurnIndex || plan.passEndTurnIndex >= state.turns.length) {
		throw new Error("Compaction Pass plan has an invalid logical-turn range")
	}
	if (plan.summaryBaselineHash !== state.summaryBaselineHash) {
		throw new Error("Compaction Pass plan summary baseline is stale")
	}
	const rangeIdentity = createCompactionPassRangeIdentity(state, plan.passStartTurnIndex, plan.passEndTurnIndex)
	const suppliedRange =
		plan.sourceHistoryHash !== undefined ||
		plan.passStartMessageIndex !== undefined ||
		plan.passEndMessageIndex !== undefined ||
		plan.rangeHash !== undefined
	if (
		suppliedRange &&
		(plan.sourceHistoryHash !== rangeIdentity.sourceHistoryHash ||
			plan.passStartMessageIndex !== rangeIdentity.passStartMessageIndex ||
			plan.passEndMessageIndex !== rangeIdentity.passEndMessageIndex ||
			plan.rangeHash !== rangeIdentity.rangeHash)
	) {
		throw new Error("Compaction Pass plan source-message range is stale or invalid")
	}
	return {
		...state,
		sourceHistory: cloneDeep(state.sourceHistory),
		sourceCanonicalRanges: cloneDeep(state.sourceCanonicalRanges ?? []),
		turns: cloneDeep(state.turns),
		protectedTail: cloneDeep(state.protectedTail),
		passStartTurnIndex: plan.passStartTurnIndex,
		passEndTurnIndex: plan.passEndTurnIndex,
		passStartMessageIndex: rangeIdentity.passStartMessageIndex,
		passEndMessageIndex: rangeIdentity.passEndMessageIndex,
		rangeHash: rangeIdentity.rangeHash,
		estimatedInputTokens: plan.estimatedInputTokens,
		passInputCeiling: plan.passInputCeiling,
		passHistoryHash: plan.passHistoryHash,
		passPlanned: true,
	}
}

/** Build the exact canonical history included in one candidate hidden compaction Pass range. */
export function buildCompactionPassHistoryForRange(
	state: TargetWindowFittingState,
	passStartTurnIndex: number,
	passEndTurnIndex: number,
): ClineStorageMessage[] {
	const passTurns = state.turns.slice(passStartTurnIndex, passEndTurnIndex + 1)
	if (passTurns.length === 0) {
		throw new Error("Compaction Pass has no uncovered logical turn")
	}
	return [
		...(state.cumulativeSummary ? [summaryMessage(state.cumulativeSummary)] : []),
		...cloneCompactionPassMessages(passTurns),
	]
}

/** Build the exact canonical history included in the planned hidden compaction Pass. */
export function buildCompactionPassHistory(state: TargetWindowFittingState): ClineStorageMessage[] {
	if (!state.passPlanned) {
		throw new Error("Compaction Pass must be planned before building its history")
	}
	const passTurns = state.turns.slice(state.passStartTurnIndex, state.passEndTurnIndex + 1)
	if (passTurns.length === 0) {
		throw new Error("Compaction Pass has no uncovered logical turn")
	}
	return [
		...(state.cumulativeSummary ? [summaryMessage(state.cumulativeSummary)] : []),
		...cloneCompactionPassMessages(passTurns),
	]
}

/** Preserve every selected logical turn verbatim; cumulative summaries are prepended separately. */
function cloneCompactionPassMessages(passTurns: readonly LogicalTurn[]): ClineStorageMessage[] {
	return cloneDeep(passTurns.flatMap((turn) => turn.messages))
}

/** Accept one valid cumulative summary and advance coverage to the next complete turn. */
export function acceptCompactionPass(state: TargetWindowFittingState, summary: string): AcceptedCompactionPass {
	if (!state.passPlanned) {
		throw new Error("Compaction Pass must be planned before accepting its summary")
	}
	const cumulativeSummary = summary.trim()
	if (!cumulativeSummary) {
		throw new Error("Compaction summary must be non-empty")
	}
	const coveredTurnCount = state.passEndTurnIndex + 1
	if (coveredTurnCount <= state.coveredTurnCount) {
		throw new Error("Compaction Pass did not advance logical-turn coverage")
	}
	const hasMoreTurns = coveredTurnCount < state.turns.length
	return {
		coveredTurnCount,
		hasMoreTurns,
		state: {
			...state,
			passIndex: state.passIndex + 1,
			summaryBaselineHash: hashSummaryBaseline(cumulativeSummary),
			sourceHistory: cloneDeep(state.sourceHistory),
			sourceCanonicalRanges: cloneDeep(state.sourceCanonicalRanges ?? []),
			turns: cloneDeep(state.turns),
			protectedTail: cloneDeep(state.protectedTail),
			coveredTurnCount,
			passStartTurnIndex: coveredTurnCount,
			passEndTurnIndex: coveredTurnCount - 1,
			passStartMessageIndex: state.turns[coveredTurnCount]?.startIndex ?? state.sourceHistory.length,
			passEndMessageIndex: (state.turns[coveredTurnCount]?.startIndex ?? state.sourceHistory.length) - 1,
			rangeHash: undefined,
			cumulativeSummary,
			estimatedInputTokens: undefined,
			passInputCeiling: undefined,
			passHistoryHash: undefined,
			passPlanned: false,
		},
	}
}

/** Compare two Pass identities by field value so key order can never affect staleness checks. */
export function areCompactionPassIdentitiesEqual(left: CompactionPassIdentity, right: CompactionPassIdentity): boolean {
	return (
		left.operationId === right.operationId &&
		left.passIndex === right.passIndex &&
		left.passStartTurnIndex === right.passStartTurnIndex &&
		left.passEndTurnIndex === right.passEndTurnIndex &&
		left.coveredTurnCount === right.coveredTurnCount &&
		left.summaryBaselineHash === right.summaryBaselineHash &&
		left.sourceHistoryHash === right.sourceHistoryHash &&
		left.passStartMessageIndex === right.passStartMessageIndex &&
		left.passEndMessageIndex === right.passEndMessageIndex &&
		left.rangeHash === right.rangeHash &&
		left.passHistoryHash === right.passHistoryHash
	)
}

/** Return the immutable identity of the current Pass plan. */
export function getCompactionPassIdentity(state: TargetWindowFittingState): CompactionPassIdentity {
	return {
		operationId: state.operationId,
		passIndex: state.passIndex,
		passStartTurnIndex: state.passStartTurnIndex,
		passEndTurnIndex: state.passEndTurnIndex,
		coveredTurnCount: state.coveredTurnCount,
		summaryBaselineHash: state.summaryBaselineHash,
		sourceHistoryHash: state.sourceHistoryHash,
		passStartMessageIndex: state.passStartMessageIndex,
		passEndMessageIndex: state.passEndMessageIndex,
		rangeHash: state.rangeHash,
		passHistoryHash: state.passHistoryHash,
	}
}

/** Bind one logical-turn selection to its exact immutable source-message coordinates. */
export function createCompactionPassRangeIdentity(
	state: TargetWindowFittingState,
	passStartTurnIndex: number,
	passEndTurnIndex: number,
): Required<Pick<CompactionPassIdentity, "sourceHistoryHash" | "passStartMessageIndex" | "passEndMessageIndex" | "rangeHash">> {
	const firstTurn = state.turns[passStartTurnIndex]
	const lastTurn = state.turns[passEndTurnIndex]
	if (!firstTurn || !lastTurn || passEndTurnIndex < passStartTurnIndex) {
		throw new Error("Compaction Pass has an invalid logical-turn range")
	}
	const passStartMessageIndex = firstTurn.startIndex
	const passEndMessageIndex = lastTurn.endIndex
	const sourceHistoryHash = state.sourceHistoryHash ?? hashJsonValue(state.sourceHistory)
	const rangeValue = {
		sourceHistoryHash,
		passStartTurnIndex,
		passEndTurnIndex,
		passStartMessageIndex,
		passEndMessageIndex,
		messages: state.sourceHistory.slice(passStartMessageIndex, passEndMessageIndex + 1),
	}
	return {
		sourceHistoryHash,
		passStartMessageIndex,
		passEndMessageIndex,
		rangeHash: hashJsonValue(rangeValue),
	}
}

/** Return the immutable canonical baseline restored after each hidden Pass. */
export function buildFittingSourceHistory(state: TargetWindowFittingState): ClineStorageMessage[] {
	return cloneDeep(state.sourceHistory)
}

/** Build the staged ordinary target history without inspecting or rewriting message content. */
export function buildTargetCandidateHistory(
	state: TargetWindowFittingState,
	continuation: readonly ClineStorageMessage[],
): ClineStorageMessage[] {
	return [
		...(state.cumulativeSummary ? [summaryMessage(state.cumulativeSummary)] : []),
		...cloneDeep(state.turns.slice(state.coveredTurnCount).flatMap((turn) => turn.messages)),
		...cloneDeep(state.protectedTail),
		...cloneDeep(continuation),
	]
}

function hashSummaryBaseline(summary: string): string {
	return hashCompactionSummary(summary)
}

function hashJsonValue(value: unknown): string {
	return hashCompactionValue(value)
}

function summaryMessage(summary: string): ClineStorageMessage {
	return {
		role: "user",
		content: [{ type: "text", text: summary }],
	}
}
