/**
 * Diagnostic bundle contract.
 *
 * A bundle is what a user hands to a maintainer after a hang or a CPU spike.
 * It therefore has to be complete enough to diagnose and provably free of
 * anything the user typed, a tool produced, or a file contained.
 *
 * The contract lives apart from the writer so that the privacy rules can be
 * asserted without constructing a zip: the entry catalogue, the redaction
 * predicate, and the checksum shape are all decidable from data.
 */

/** Entries a default bundle always contains, in listing order. */
export const BUNDLE_ENTRIES = {
	manifest: "manifest.json",
	events: "events.jsonl",
	diagnoses: "diagnoses.json",
	scenario: "scenario.json",
	environment: "environment.json",
	checksums: "checksums.json",
} as const

export type BundleEntryName = (typeof BUNDLE_ENTRIES)[keyof typeof BUNDLE_ENTRIES]

/** Entry names in the order they are written into the archive. */
export function defaultBundleEntryNames(): readonly BundleEntryName[] {
	return Object.values(BUNDLE_ENTRIES)
}

/**
 * Attribute and field names that must never appear in a bundle.
 *
 * This is intentionally broader than the runtime attribute policy: a bundle
 * also carries diagnoses and scenario steps, which are assembled from several
 * producers and are not individually policed at record time.
 */
const FORBIDDEN_FIELD_NAMES = new Set([
	"accesskey",
	"accesstoken",
	"apikey",
	"apisecret",
	"args",
	"arguments",
	"authorization",
	"bearer",
	"body",
	"clientsecret",
	"cmd",
	"command",
	"commandline",
	"completion",
	"content",
	"cookie",
	"credential",
	"credentials",
	"diff",
	"filecontent",
	"idtoken",
	"input",
	"message",
	"output",
	"pairingcode",
	"params",
	"passphrase",
	"password",
	"patch",
	"payload",
	"privatekey",
	"prompt",
	"proxyauthorization",
	"query",
	"refreshtoken",
	"response",
	"result",
	"secret",
	"secretkey",
	"sessiontoken",
	"setcookie",
	"stderr",
	"stdin",
	"stdout",
	"systemprompt",
	"text",
	"title",
	"token",
	"xapikey",
])

function normalizeFieldName(name: string): string {
	return name.toLowerCase().replaceAll("-", "").replaceAll("_", "")
}

/** True when a field name denotes content or a credential. */
export function isForbiddenBundleField(name: string): boolean {
	return FORBIDDEN_FIELD_NAMES.has(normalizeFieldName(name))
}

/** Markers written in place of a value the redactor refused to serialize. */
export const REDACTION_MARKERS = {
	circular: "[circular]",
	depthLimit: "[depth-limit]",
	unsupported: "[unsupported]",
	secret: "[secret]",
} as const

/** Maximum object nesting the redactor descends before bailing out. */
const MAX_REDACTION_DEPTH = 8

/**
 * Patterns that indicate a credential embedded in an otherwise allowed value.
 *
 * Key-based redaction cannot catch a token pasted into a field named
 * `operation`, so retained strings are scrubbed as well. The patterns target
 * credential shapes rather than English words, so ordinary diagnostic text
 * survives.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
	// `Authorization: Bearer <token>`, `api-key = <token>`, `password: <token>`.
	// The optional scheme word is consumed together with the value so a
	// `Bearer` prefix cannot leave the credential itself behind.
	/\b(?:authorization|bearer|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|id[\s_-]?token|client[\s_-]?secret|private[\s_-]?key|passphrase|password|secret|credential|cookie|pairing[\s_-]?code)\b\s*[:=]?\s*(?:bearer|basic|token)?\s*\S+/gi,
	/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
]

/**
 * Replace credential-shaped substrings inside a retained string.
 *
 * Exported so raw artifacts can reuse the same rules as structured entries.
 */
export function scrubSecretText(value: string): string {
	let scrubbed = value
	for (const pattern of SECRET_VALUE_PATTERNS) {
		pattern.lastIndex = 0
		scrubbed = scrubbed.replace(pattern, REDACTION_MARKERS.secret)
	}
	return scrubbed
}

/** Non-object values, scrubbed and screened for non-JSON types. */
function redactPrimitive(value: unknown): unknown {
	if (typeof value === "string") return scrubSecretText(value)
	if (typeof value === "number") return Number.isFinite(value) ? value : REDACTION_MARKERS.unsupported
	if (typeof value === "boolean") return value
	if (value === null) return null
	// Functions, symbols, bigint and undefined are not representable in a
	// bundle, and a retained function would let `toJSON` re-inject data during
	// a later stringify.
	return REDACTION_MARKERS.unsupported
}

function redactValue(value: unknown, depth: number, seen: Set<object>): unknown {
	if (typeof value !== "object" || value === null) {
		return redactPrimitive(value)
	}
	if (depth >= MAX_REDACTION_DEPTH) {
		return REDACTION_MARKERS.depthLimit
	}
	if (seen.has(value)) {
		return REDACTION_MARKERS.circular
	}

	seen.add(value)
	try {
		if (Array.isArray(value)) {
			return value.map((item) => redactValue(item, depth + 1, seen))
		}
		if (value instanceof Date) {
			return Number.isFinite(value.getTime()) ? value.toISOString() : REDACTION_MARKERS.unsupported
		}
		if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) {
			// Not JSON round-trippable; serializing them as `{}` would hide the
			// fact that evidence was dropped.
			return REDACTION_MARKERS.unsupported
		}

		// A null-prototype accumulator keeps `__proto__`, `constructor` and
		// `toJSON` keys in the source from mutating the output or surviving
		// into a later JSON.stringify.
		const result = Object.create(null) as Record<string, unknown>
		for (const key of Object.keys(value)) {
			if (isForbiddenBundleField(key)) continue
			result[key] = redactValue((value as Record<string, unknown>)[key], depth + 1, seen)
		}
		return { ...result }
	} finally {
		seen.delete(value)
	}
}

/**
 * Remove forbidden fields from an arbitrary JSON-like value.
 *
 * Redaction is structural first: a value is dropped because of the key that
 * carries it, so a producer cannot smuggle content through by changing its
 * formatting. Retained strings are then scrubbed for credential shapes, since
 * a key-only rule cannot see a token pasted into an allowed field.
 *
 * Anything that is not plain JSON (functions, Map/Set, typed arrays, cycles,
 * over-deep nesting) becomes an explicit marker instead of vanishing, so a
 * reader can tell dropped evidence apart from absent evidence.
 */
export function redactBundleValue(value: unknown): unknown {
	return redactValue(value, 0, new Set<object>())
}

/** Bundle-level identity written into `manifest.json`. */
export interface BundleManifest {
	readonly schemaVersion: 1
	readonly sessionId: string
	readonly createdAt: number
	readonly extensionVersion: string
	readonly buildId?: string
	readonly entries: readonly BundleEntryName[]
	readonly eventCount: number
	readonly diagnosisCount: number
	/** True when the user explicitly opted into extra raw artifacts. */
	readonly includesRawArtifacts: boolean
}

/** SHA-256 of every entry, keyed by entry name. */
export type BundleChecksums = Readonly<Record<string, string>>
