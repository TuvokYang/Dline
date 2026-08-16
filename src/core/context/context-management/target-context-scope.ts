export interface TargetContextScopeInput {
	providerContextWindow: number
	maxContextTokens?: number
}

export interface TargetContextScope {
	targetContextWindow: number
	fittingExitTarget: number
}

const FITTING_EXIT_RATIO = 0.8

/** Resolve the effective ordinary-request context window and its strict fitting exit target. */
export function resolveTargetContextScope(input: TargetContextScopeInput): TargetContextScope {
	const providerContextWindow = normalizePositiveInteger(input.providerContextWindow)
	if (providerContextWindow === 0) {
		throw new Error("Target provider context window must be positive")
	}
	const maxContextTokens = normalizePositiveInteger(input.maxContextTokens)
	const targetContextWindow = maxContextTokens > 0 ? Math.min(providerContextWindow, maxContextTokens) : providerContextWindow
	return {
		targetContextWindow,
		fittingExitTarget: Math.floor(targetContextWindow * FITTING_EXIT_RATIO),
	}
}

/** Continue fitting while the complete target candidate is at or above the exit target. */
export function shouldContinueTargetWindowFitting(projectedUsageTokens: number, scope: TargetContextScope): boolean {
	return normalizePositiveInteger(projectedUsageTokens) >= scope.fittingExitTarget
}

function normalizePositiveInteger(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
