import type { CompactTriggerOptions } from "./context-window-utils"
import { resolveTargetContextScope, shouldContinueTargetWindowFitting } from "./target-context-scope"

export interface DecideTargetWindowFittingInput extends CompactTriggerOptions {
	candidateEstimatedTokens: number
	providerContextWindow: number
	hasMoreTurns: boolean
}

export type TargetWindowFittingDecisionStatus = "continue" | "complete" | "exhausted"

export interface TargetWindowFittingDecision {
	status: TargetWindowFittingDecisionStatus
	projectedUsageTokens: number
	targetContextWindow: number
	effectiveContextLimit: number
	fittingExitTarget: number
}

/** Decide whether the fully rebuilt ordinary target candidate has converged. */
export function decideTargetWindowFitting(input: DecideTargetWindowFittingInput): TargetWindowFittingDecision {
	const scope = resolveTargetContextScope(input)
	const projectedUsageTokens = normalizeCandidateTokens(input.candidateEstimatedTokens)
	const mustContinue = shouldContinueTargetWindowFitting(projectedUsageTokens, scope)
	return {
		status: mustContinue ? (input.hasMoreTurns ? "continue" : "exhausted") : "complete",
		projectedUsageTokens,
		targetContextWindow: scope.targetContextWindow,
		effectiveContextLimit: scope.effectiveContextLimit,
		fittingExitTarget: scope.fittingExitTarget,
	}
}

function normalizeCandidateTokens(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
