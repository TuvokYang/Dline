/** Complete target-candidate inputs used by explicit Profile and Mode transitions. */
export interface ContextTransitionPreflightInput {
	projectedUsageTokens: number
	targetContextWindow: number
}

/** Explicit transitions confirm only when the complete candidate exceeds the target maximum. */
export type ContextTransitionPreflightDecision = { kind: "commit" } | { kind: "confirm" }

/** Apply the strict explicit-transition boundary without compact-trigger tolerance. */
export function decideContextTransition(input: ContextTransitionPreflightInput): ContextTransitionPreflightDecision {
	return input.projectedUsageTokens > input.targetContextWindow ? { kind: "confirm" } : { kind: "commit" }
}
