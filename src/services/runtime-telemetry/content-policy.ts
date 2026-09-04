import { createHmac, randomBytes } from "node:crypto"
import type { RuntimeAttributes, RuntimeAttributeValue } from "./types"

/**
 * Content policy for runtime telemetry attributes.
 *
 * Producers pass untyped attribute bags, so this module is the boundary that
 * decides what may leave the extension host. It rejects the fields that carry
 * user or tool content outright rather than truncating them, because a
 * truncated command line is still a command line.
 */

/** Attribute names that always denote user or tool content. */
const FORBIDDEN_KEYS = new Set([
	"args",
	"arguments",
	"body",
	"cmd",
	"command",
	"commandline",
	"completion",
	"content",
	"diff",
	"filecontent",
	"input",
	"message",
	"output",
	"params",
	"patch",
	"payload",
	"prompt",
	"query",
	"response",
	"result",
	"stderr",
	"stdin",
	"stdout",
	"systemprompt",
	"text",
	"title",
])

/**
 * Maximum length of a retained string attribute.
 *
 * Identifiers, phase names, and outcomes are all far shorter than this; a
 * longer value means a producer is smuggling content through a permitted key.
 */
const MAX_ATTRIBUTE_LENGTH = 120

/** Maximum number of attributes retained on a single event. */
const MAX_ATTRIBUTE_COUNT = 32

/**
 * Maximum number of distinct values remembered per attribute name.
 *
 * Beyond this the attribute is behaving like an identifier rather than a
 * dimension, and keeping it would let a backend reconstruct per-user series.
 */
const MAX_CARDINALITY = 200

export enum AttributeRejection {
	ForbiddenKey = "forbidden_key",
	UnsupportedType = "unsupported_type",
	TooLong = "too_long",
	TooManyAttributes = "too_many_attributes",
	HighCardinality = "high_cardinality",
}

export interface AttributePolicyResult {
	readonly attributes: RuntimeAttributes
	readonly rejections: ReadonlyMap<string, AttributeRejection>
}

function normalizeKey(key: string): string {
	return key.toLowerCase().replaceAll("-", "").replaceAll("_", "")
}

/**
 * Enforces the attribute contract and tracks per-name cardinality.
 *
 * Cardinality is stateful across events, so this is a class rather than a
 * free function: a single-event view cannot tell a stable dimension from an
 * identifier.
 */
export class RuntimeContentPolicy {
	/** Session-scoped key so fingerprints cannot be correlated across installs. */
	private readonly fingerprintKey: Buffer
	private readonly observedValues = new Map<string, Set<string>>()

	constructor(fingerprintKey: Buffer = randomBytes(32)) {
		this.fingerprintKey = fingerprintKey
	}

	/**
	 * Derive a stable, non-reversible identifier for a sensitive value.
	 *
	 * Used for workspace roots, command shapes, and error grouping, where
	 * events must be correlatable without revealing the original value.
	 */
	fingerprint(value: string): string {
		return createHmac("sha256", this.fingerprintKey).update(value).digest("hex").slice(0, 16)
	}

	/** Apply the attribute contract, returning the retained subset. */
	apply(input: Readonly<Record<string, unknown>> | undefined): AttributePolicyResult {
		const attributes: Record<string, RuntimeAttributeValue> = {}
		const rejections = new Map<string, AttributeRejection>()
		if (!input) return { attributes, rejections }

		let retained = 0
		for (const [key, value] of Object.entries(input)) {
			if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
				rejections.set(key, AttributeRejection.ForbiddenKey)
				continue
			}
			if (retained >= MAX_ATTRIBUTE_COUNT) {
				rejections.set(key, AttributeRejection.TooManyAttributes)
				continue
			}

			const rejection = this.admit(key, value, attributes)
			if (rejection) {
				rejections.set(key, rejection)
				continue
			}
			retained += 1
		}

		return { attributes, rejections }
	}

	/** Reset cardinality tracking. Used when a session ends. */
	reset(): void {
		this.observedValues.clear()
	}

	private admit(
		key: string,
		value: unknown,
		attributes: Record<string, RuntimeAttributeValue>,
	): AttributeRejection | undefined {
		if (typeof value === "number") {
			if (!Number.isFinite(value)) return AttributeRejection.UnsupportedType
			attributes[key] = value
			return undefined
		}
		if (typeof value === "boolean") {
			attributes[key] = value
			return undefined
		}
		if (typeof value !== "string") {
			return AttributeRejection.UnsupportedType
		}
		if (value.length > MAX_ATTRIBUTE_LENGTH) {
			return AttributeRejection.TooLong
		}
		if (this.exceedsCardinality(key, value)) {
			return AttributeRejection.HighCardinality
		}

		attributes[key] = value
		return undefined
	}

	private exceedsCardinality(key: string, value: string): boolean {
		let seen = this.observedValues.get(key)
		if (!seen) {
			seen = new Set<string>()
			this.observedValues.set(key, seen)
		}
		if (seen.has(value)) return false
		if (seen.size >= MAX_CARDINALITY) return true
		seen.add(value)
		return false
	}
}

export const runtimeContentPolicyLimits = {
	MAX_ATTRIBUTE_LENGTH,
	MAX_ATTRIBUTE_COUNT,
	MAX_CARDINALITY,
} as const
