import type { ClineStorageMessage } from "@shared/messages/content"
import { hashCompactionValue } from "./compaction-hash"
import {
	buildCompactionPassHistoryForRange,
	createCompactionPassRangeIdentity,
	type CompactionPassIdentity,
	type TargetWindowFittingState,
} from "./target-window-fitting"

export interface CompactionPassPlan extends CompactionPassIdentity {
	estimatedInputTokens: number
	passInputCeiling: number
	passHistoryHash: string
}

export interface PlanNextCompactionPassInput {
	state: TargetWindowFittingState
	passInputCeiling: number
	estimateInputTokens(messages: readonly ClineStorageMessage[]): number | Promise<number>
}

export type PlanNextCompactionPassResult =
	| { kind: "planned"; plan: CompactionPassPlan }
	| {
			kind: "needs_smaller_input"
			turnIndex: number
			estimatedInputTokens: number
			passInputCeiling: number
	  }

/** Select the maximal contiguous complete-turn batch that fits the full hidden request ceiling. */
export async function planNextCompactionPass(input: PlanNextCompactionPassInput): Promise<PlanNextCompactionPassResult> {
	const passInputCeiling = normalizeTokenCount(input.passInputCeiling)
	const passStartTurnIndex = input.state.coveredTurnCount
	if (passStartTurnIndex >= input.state.turns.length) {
		throw new Error("No uncovered logical turn is available for the next compaction Pass")
	}

	let acceptedPlan: CompactionPassPlan | undefined
	for (let passEndTurnIndex = passStartTurnIndex; passEndTurnIndex < input.state.turns.length; passEndTurnIndex++) {
		const passHistory = buildCompactionPassHistoryForRange(input.state, passStartTurnIndex, passEndTurnIndex)
		const estimatedInputTokens = normalizeTokenCount(await input.estimateInputTokens(passHistory))
		if (estimatedInputTokens > passInputCeiling) {
			if (!acceptedPlan) {
				return {
					kind: "needs_smaller_input",
					turnIndex: passStartTurnIndex,
					estimatedInputTokens,
					passInputCeiling,
				}
			}
			break
		}
		const rangeIdentity = createCompactionPassRangeIdentity(input.state, passStartTurnIndex, passEndTurnIndex)
		acceptedPlan = {
			operationId: input.state.operationId,
			passIndex: input.state.passIndex,
			passStartTurnIndex,
			passEndTurnIndex,
			coveredTurnCount: input.state.coveredTurnCount,
			summaryBaselineHash: input.state.summaryBaselineHash,
			...rangeIdentity,
			estimatedInputTokens,
			passInputCeiling,
			passHistoryHash: hashPassHistory(passHistory),
		}
	}

	if (!acceptedPlan) {
		throw new Error("Unable to plan a non-empty compaction Pass")
	}
	return { kind: "planned", plan: acceptedPlan }
}

function normalizeTokenCount(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function hashPassHistory(history: readonly ClineStorageMessage[]): string {
	return hashCompactionValue(history)
}
