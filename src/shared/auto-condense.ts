export const DEFAULT_AUTO_CONDENSE_TRIGGER_PERCENT = 97
export const MIN_AUTO_CONDENSE_TRIGGER_PERCENT = 1
export const MAX_AUTO_CONDENSE_TRIGGER_PERCENT = 97
export const DEFAULT_AUTO_CONDENSE_MAX_CONTEXT_TOKENS = 0
export const MAX_AUTO_CONDENSE_CONTEXT_TOKENS = 2_147_483_647

export function normalizeAutoCondenseTriggerPercent(value: unknown): number {
	const numericValue = Number(value)
	if (!Number.isFinite(numericValue)) {
		return DEFAULT_AUTO_CONDENSE_TRIGGER_PERCENT
	}
	return Math.min(Math.max(Math.round(numericValue), MIN_AUTO_CONDENSE_TRIGGER_PERCENT), MAX_AUTO_CONDENSE_TRIGGER_PERCENT)
}

export function normalizeAutoCondenseMaxContextTokens(value: unknown): number {
	const numericValue = Number(value)
	if (!Number.isFinite(numericValue) || numericValue <= 0) {
		return DEFAULT_AUTO_CONDENSE_MAX_CONTEXT_TOKENS
	}
	return Math.min(Math.floor(numericValue), MAX_AUTO_CONDENSE_CONTEXT_TOKENS)
}
