const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429])

/** Decide whether replaying the same immutable compaction Pass can recover from an error. */
export function isRetryableCompactionError(error: unknown): boolean {
	const status = extractHttpStatus(error)
	if (status === undefined) return true
	return RETRYABLE_HTTP_STATUSES.has(status) || status >= 500
}

function extractHttpStatus(error: unknown): number | undefined {
	const record = asRecord(error)
	const nestedError = asRecord(record?.error)
	const response = asRecord(record?.response)
	for (const candidate of [
		record?.status,
		record?.statusCode,
		response?.status,
		nestedError?.status,
		nestedError?.statusCode,
	]) {
		const status = typeof candidate === "number" ? candidate : Number(candidate)
		if (Number.isInteger(status) && status >= 100 && status <= 599) return status
	}

	const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
	const match = message.match(/^\s*(\d{3})\b/) ?? message.match(/"(?:status|code)"\s*:\s*(\d{3})/)
	if (!match) return undefined
	const status = Number(match[1])
	return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}
