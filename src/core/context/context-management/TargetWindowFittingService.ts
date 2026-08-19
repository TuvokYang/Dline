import { resolveTargetContextScope, shouldContinueTargetWindowFitting } from "./target-context-scope"

export interface DecideTargetWindowFittingInput {
	candidateEstimatedTokens: number
	providerContextWindow: number
	maxContextTokens?: number
	hasMoreTurns: boolean
}

export type TargetWindowFittingDecisionStatus = "continue" | "complete" | "exhausted"

export interface TargetWindowFittingDecision {
	status: TargetWindowFittingDecisionStatus
	projectedUsageTokens: number
	targetContextWindow: number
	fittingExitTarget: number
}

/** Decide whether the fully rebuilt ordinary target candidate has converged. */
export function decideTargetWindowFitting(input: DecideTargetWindowFittingInput): TargetWindowFittingDecision {
	const scope = resolveTargetContextScope({
		providerContextWindow: input.providerContextWindow,
		maxContextTokens: input.maxContextTokens,
	})
	const projectedUsageTokens = normalizeCandidateTokens(input.candidateEstimatedTokens)
	const mustContinue = shouldContinueTargetWindowFitting(projectedUsageTokens, scope)
	const fitsHardWindow = projectedUsageTokens < scope.targetContextWindow
	return {
		status: mustContinue ? (input.hasMoreTurns ? "continue" : fitsHardWindow ? "complete" : "exhausted") : "complete",
		projectedUsageTokens,
		targetContextWindow: scope.targetContextWindow,
		fittingExitTarget: scope.fittingExitTarget,
	}
}

function normalizeCandidateTokens(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
