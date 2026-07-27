import type { ClineToolResponseContent, ClineUserToolResultContentBlock } from "@shared/messages"

export const DURABLE_TOOL_RESULT_VERSION = 1 as const

interface DurableToolResultV1 {
	version: typeof DURABLE_TOOL_RESULT_VERSION
	function_id: string
	dline_tid: string
	content: ClineToolResponseContent
	is_error: boolean | null
}

interface LegacyDurableToolResult {
	function_id: string
	dline_tid: string
	result: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasIdentity(value: Record<string, unknown>): value is Record<string, unknown> & {
	function_id: string
	dline_tid: string
} {
	return (
		typeof value.function_id === "string" &&
		value.function_id.length > 0 &&
		typeof value.dline_tid === "string" &&
		value.dline_tid.length > 0
	)
}

function isToolResponseContent(value: unknown): value is ClineToolResponseContent {
	return typeof value === "string" || Array.isArray(value)
}

/** Serialize the exact canonical tool result inserted into the next API turn. */
export function serializeDurableToolResult(result: ClineUserToolResultContentBlock): string {
	const persisted: DurableToolResultV1 = {
		version: DURABLE_TOOL_RESULT_VERSION,
		function_id: result.function_id,
		dline_tid: result.dline_tid,
		content: result.content,
		is_error: result.is_error ?? null,
	}
	return JSON.stringify(persisted)
}

/**
 * Parse a durable result without guessing whether an unversioned string was
 * originally JSON text or structured content.
 */
export function parseDurableToolResult(text: string): ClineUserToolResultContentBlock | undefined {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return undefined
	}
	if (!isRecord(value) || !hasIdentity(value)) return undefined

	if (value.version === DURABLE_TOOL_RESULT_VERSION) {
		if (!isToolResponseContent(value.content) || (value.is_error !== null && typeof value.is_error !== "boolean")) {
			return undefined
		}
		return {
			type: "tool_result",
			function_id: value.function_id,
			dline_tid: value.dline_tid,
			content: value.content,
			...(value.is_error === null ? {} : { is_error: value.is_error }),
		}
	}

	// Legacy rows only stored one ambiguous string. Treat it literally; parsing
	// strings such as "[]" would silently change a valid textual tool result.
	if (value.version === undefined && typeof value.result === "string") {
		const legacy = value as unknown as LegacyDurableToolResult
		return {
			type: "tool_result",
			function_id: legacy.function_id,
			dline_tid: legacy.dline_tid,
			content: [{ type: "text", text: legacy.result || "(tool did not return anything)" }],
		}
	}

	return undefined
}
