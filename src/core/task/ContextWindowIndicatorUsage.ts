export interface ContextWindowProviderUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

export interface ContextWindowProviderUsageChunk {
	type?: "usage"
	inputTokens?: number
	outputTokens?: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
}

/** Merge provider usage snapshots without double-counting repeated request totals. */
export function mergeContextWindowProviderUsage(
	current: ContextWindowProviderUsage | undefined,
	chunk: ContextWindowProviderUsageChunk,
): ContextWindowProviderUsage {
	const next: ContextWindowProviderUsage = {
		inputTokens: normalizeTokens(chunk.inputTokens),
		outputTokens: normalizeTokens(chunk.outputTokens),
		cacheWriteTokens: normalizeTokens(chunk.cacheWriteTokens),
		cacheReadTokens: normalizeTokens(chunk.cacheReadTokens),
	}
	if (!current) return next

	return {
		inputTokens: Math.max(current.inputTokens, next.inputTokens),
		outputTokens: Math.max(current.outputTokens, next.outputTokens),
		cacheWriteTokens: Math.max(current.cacheWriteTokens, next.cacheWriteTokens),
		cacheReadTokens: Math.max(current.cacheReadTokens, next.cacheReadTokens),
	}
}

export function getContextWindowProviderUsageTotal(usage: ContextWindowProviderUsage | undefined): number {
	if (!usage) return 0
	return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens
}

function normalizeTokens(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
