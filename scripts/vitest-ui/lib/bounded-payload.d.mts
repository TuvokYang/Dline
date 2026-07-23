export const MAX_SERIALIZED_PAYLOAD_CHARS: number

export function boundStructuredPayload<T>(value: T, maxChars?: number): T | Record<string, unknown>

export function stringifyBoundedPayload(value: unknown, space?: number, maxChars?: number): string
