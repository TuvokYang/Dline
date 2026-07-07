export interface ContextUsageInput {
	contextWindow: number
	lastApiReqTotalTokens: number
	modelId: string
}

/**
 * Decide whether environment details should include context usage.
 *
 * @param input Context usage inputs from the active API handler.
 * @returns True when context usage should be rendered.
 */
export function showContextUsage(input: ContextUsageInput): boolean {
	return input.contextWindow > 0
}
