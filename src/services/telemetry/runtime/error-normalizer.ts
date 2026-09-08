import { redactDiagnosticString } from "@/shared/services/logging/safe-diagnostic-value"
import type { NormalizedRuntimeError } from "./types"

/**
 * Reduce an arbitrary thrown value to fields that are safe to publish and
 * stable enough to group by.
 *
 * Producers catch values from HTTP clients, SDKs, and the platform, so this
 * accepts `unknown`. The fingerprint deliberately excludes task ids, ports,
 * temporary paths, and numbers, because including them would make every
 * occurrence of the same defect look unique.
 */

const MAX_MESSAGE_LENGTH = 200
const MAX_CAUSE_DEPTH = 3

/**
 * Sources for the volatile substrings removed before fingerprinting.
 *
 * These are pattern sources rather than `RegExp` instances: a shared global
 * regex carries a mutable `lastIndex`, so reusing one across calls would leave
 * later matches unmasked and give two occurrences of one defect different
 * fingerprints.
 */
const VOLATILE_PATTERN_SOURCES: readonly string[] = [
	"\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", // uuid
	"\\d+", // ids, durations, ports, counts
]

interface ErrorLikeFields {
	readonly name?: unknown
	readonly message?: unknown
	readonly code?: unknown
	readonly status?: unknown
	readonly statusCode?: unknown
	readonly stack?: unknown
	readonly cause?: unknown
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function truncate(message: string): string {
	const redacted = redactDiagnosticString(message)
	return redacted.length <= MAX_MESSAGE_LENGTH ? redacted : `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
}

/**
 * Extract the first project stack frame, reduced to `file:line`.
 *
 * The absolute prefix identifies the developer's machine and the install
 * location, so only the path tail is kept.
 */
function extractSourceFrame(stack: string | undefined): string | undefined {
	if (!stack) return undefined
	for (const line of stack.split("\n")) {
		const match = /\(?([^()\s]+[/\\][^()\s]+?):(\d+):\d+\)?$/.exec(line.trim())
		if (!match) continue
		const [, filePath, lineNumber] = match
		if (filePath.includes("node_modules")) continue
		const segments = filePath.split(/[/\\]/)
		const tail = segments.slice(-2).join("/")
		return `${tail}:${lineNumber}`
	}
	return undefined
}

/** Mask the parts of a message that change between occurrences. */
function stripVolatile(value: string): string {
	return VOLATILE_PATTERN_SOURCES.reduce((current, source) => current.replace(new RegExp(source, "gi"), "*"), value)
}

/**
 * Build a grouping key from the fields that stay constant across occurrences.
 *
 * The message is included with volatile substrings masked, because two
 * failures of the same class often differ only by a path or an id.
 *
 * Only the file part of the frame participates. Including the line number
 * would split one defect's history every time surrounding code shifts, which
 * defeats the purpose of grouping; the exact line stays available on
 * `sourceFrame` for navigation.
 */
function buildFingerprint(name: string, code: string | undefined, message: string, sourceFrame: string | undefined): string {
	const sourceFile = sourceFrame?.replace(/:\d+$/, "")
	return [name, code ?? "-", stripVolatile(message), sourceFile ?? "-"].join("|")
}

export function normalizeRuntimeError(value: unknown, depth = 0): NormalizedRuntimeError {
	if (typeof value === "string") {
		const message = truncate(value)
		return {
			name: "Error",
			message,
			fingerprint: buildFingerprint("Error", undefined, message, undefined),
		}
	}
	if (value === null || typeof value !== "object") {
		const message = truncate(String(value))
		return {
			name: "NonError",
			message,
			fingerprint: buildFingerprint("NonError", undefined, message, undefined),
		}
	}

	const fields = value as ErrorLikeFields
	const name = readString(fields.name) ?? (value instanceof Error ? value.constructor.name : "Error")
	const message = truncate(readString(fields.message) ?? "")
	const code = readString(fields.code)
	const status = readNumber(fields.status) ?? readNumber(fields.statusCode)
	const sourceFrame = extractSourceFrame(readString(fields.stack))

	const cause =
		fields.cause !== undefined && depth < MAX_CAUSE_DEPTH ? normalizeRuntimeError(fields.cause, depth + 1) : undefined

	return {
		name,
		message,
		code,
		status,
		sourceFrame,
		fingerprint: buildFingerprint(name, code, message, sourceFrame),
		cause,
	}
}
