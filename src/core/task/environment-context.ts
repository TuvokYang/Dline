export interface ContextUsageInput {
	contextWindow: number
	lastApiReqTotalTokens: number
	modelId: string
}

const HIGH_CONTEXT_PRESSURE_USED_RATIO = 0.9

/**
 * Decide whether environment details should include context usage.
 *
 * @param input Context usage inputs from the active API handler.
 * @returns True when context usage should be rendered.
 */
export function showContextUsage(input: ContextUsageInput): boolean {
	return input.contextWindow > 0
}

/**
 * Render execution guidance when strictly less than 10% of the context window remains.
 *
 * @param input Context usage inputs from the active API handler.
 * @returns A warning section for the next provider request, or an empty string outside high pressure.
 */
export function getHighContextPressureWarning(input: ContextUsageInput): string {
	if (
		!Number.isFinite(input.contextWindow) ||
		!Number.isFinite(input.lastApiReqTotalTokens) ||
		input.contextWindow <= 0 ||
		input.lastApiReqTotalTokens <= input.contextWindow * HIGH_CONTEXT_PRESSURE_USED_RATIO
	) {
		return ""
	}

	return `# High Context Pressure
Less than 10% of the context window remains for the complete projected request candidate.
Avoid launching too many parallel tool calls that may produce large results.
Keep tool output focused and continue the current work efficiently.
Do not skip information or verification required to complete the current task.`
}
