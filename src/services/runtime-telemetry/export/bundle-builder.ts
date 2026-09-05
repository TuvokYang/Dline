import { createHash } from "node:crypto"
import type { RootCauseDiagnosis } from "../analysis/root-cause-types"
import type { RuntimeTelemetryEvent } from "../types"
import {
	BUNDLE_ENTRIES,
	type BundleChecksums,
	type BundleEntryName,
	type BundleManifest,
	defaultBundleEntryNames,
	redactBundleValue,
	scrubSecretText,
} from "./bundle-contract"

/**
 * Assembles the in-memory contents of a diagnostic bundle.
 *
 * Building and writing are separate concerns: the archive writer deals with
 * file handles, temp paths, and the host save dialog, while this module owns
 * what the bundle is allowed to contain. Keeping them apart is what makes the
 * privacy rules testable without touching the disk.
 */

/** Environment facts that help interpret timings without identifying the user. */
export interface BundleEnvironment {
	readonly platform: string
	readonly arch: string
	readonly nodeVersion: string
	readonly hostVersion: string
	readonly extensionVersion: string
	readonly cpuCount: number
	readonly totalMemoryBytes: number
}

/**
 * One replayable step.
 *
 * Steps describe what happened, never what was said. `outcome` is a controlled
 * vocabulary rather than free text so a replay harness can branch on it.
 */
export interface ScenarioStep {
	readonly index: number
	readonly component: string
	readonly operation: string
	readonly outcome: string
	readonly durationMs?: number
	readonly offsetMs: number
}

export interface BundleInput {
	readonly sessionId: string
	readonly createdAt: number
	readonly events: readonly RuntimeTelemetryEvent[]
	readonly diagnoses: readonly RootCauseDiagnosis[]
	readonly environment: BundleEnvironment
	readonly buildId?: string
	/**
	 * Raw artifacts the user explicitly selected.
	 *
	 * Empty by default. The builder still redacts them, because consent to
	 * attach a file is not consent to leak a credential inside it.
	 */
	readonly rawArtifacts?: readonly RawArtifact[]
}

export interface RawArtifact {
	readonly name: string
	readonly content: string
}

/** Raised when a consented artifact cannot be attached safely. */
export class UnsafeRawArtifact extends Error {
	constructor(message: string) {
		super(message)
		this.name = "UnsafeRawArtifact"
	}
}

export interface BuiltBundleEntry {
	readonly name: string
	readonly content: string
}

export interface BuiltBundle {
	readonly manifest: BundleManifest
	readonly entries: readonly BuiltBundleEntry[]
	readonly checksums: BundleChecksums
}

/** Prefix under which consented raw artifacts are stored. */
const RAW_ARTIFACT_PREFIX = "raw/"

/** Artifact names are archive entries, not paths: no traversal, no separators. */
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex")
}

/**
 * Reject artifact names that could escape the `raw/` prefix or collide.
 *
 * Consent covers the file's contents, not an arbitrary archive path: a name
 * like `../../manifest.json` would let an artifact overwrite a bundle entry,
 * and an absolute path would leak the user's directory layout.
 */
function assertSafeArtifactName(name: string, taken: Set<string>): void {
	if (!SAFE_ARTIFACT_NAME.test(name)) {
		throw new UnsafeRawArtifact(`raw artifact name is not a safe archive entry: ${JSON.stringify(name)}`)
	}
	if (name === "." || name === "..") {
		throw new UnsafeRawArtifact("raw artifact name must not be a directory reference")
	}
	if (taken.has(name)) {
		throw new UnsafeRawArtifact(`duplicate raw artifact name: ${name}`)
	}
	taken.add(name)
}

/**
 * Redact a consented artifact's contents.
 *
 * Consent to attach a file is not consent to leak a credential inside it, so
 * the artifact goes through the same rules as structured entries. JSON gets
 * the structural pass (forbidden keys removed); anything else is scrubbed for
 * credential shapes.
 */
function redactArtifactContent(content: string): string {
	const trimmed = content.trimStart()
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.stringify(redactBundleValue(JSON.parse(content)), null, 2)
		} catch {
			// Not valid JSON despite the leading brace: fall through to text.
		}
	}
	return scrubSecretText(content)
}

/**
 * Convert events into replay steps.
 *
 * The offset is relative to the first event so a reader can see the shape of
 * the session without learning when the user was working.
 */
function buildScenarioSteps(events: readonly RuntimeTelemetryEvent[]): ScenarioStep[] {
	if (events.length === 0) return []
	const origin = events[0].timestamp

	return events.map((event, index) => {
		const attributes = event.attributes
		const durationMs = typeof attributes.durationMs === "number" ? attributes.durationMs : undefined
		const component = typeof attributes.component === "string" ? attributes.component : event.name.split(".")[0]
		const operation = typeof attributes.operation === "string" ? attributes.operation : event.name
		const outcome = typeof attributes.outcome === "string" ? attributes.outcome : event.error ? "failed" : "observed"

		return {
			index,
			component,
			operation,
			outcome,
			durationMs,
			offsetMs: Math.max(0, event.timestamp - origin),
		}
	})
}

/**
 * Build the bundle contents.
 *
 * Every entry goes through `redactBundleValue`, including events that already
 * passed the runtime attribute policy: the bundle is the last boundary before
 * data leaves the machine, and a second pass costs nothing at export time.
 */
export function buildDiagnosticBundle(input: BundleInput): BuiltBundle {
	const redactedEvents = input.events.map((event) => redactBundleValue(event))
	const eventsContent = redactedEvents.map((event) => JSON.stringify(event)).join("\n")
	const diagnosesContent = JSON.stringify(redactBundleValue(input.diagnoses), null, 2)
	const scenarioContent = JSON.stringify(
		redactBundleValue({
			schemaVersion: 1,
			sessionId: input.sessionId,
			steps: buildScenarioSteps(input.events),
		}),
		null,
		2,
	)
	const environmentContent = JSON.stringify(redactBundleValue(input.environment), null, 2)

	const takenArtifactNames = new Set<string>()
	const rawEntries = (input.rawArtifacts ?? []).map((artifact) => {
		assertSafeArtifactName(artifact.name, takenArtifactNames)
		return {
			name: `${RAW_ARTIFACT_PREFIX}${artifact.name}`,
			content: redactArtifactContent(artifact.content),
		}
	})

	const manifest: BundleManifest = {
		schemaVersion: 1,
		sessionId: input.sessionId,
		createdAt: input.createdAt,
		extensionVersion: input.environment.extensionVersion,
		buildId: input.buildId,
		entries: [...defaultBundleEntryNames(), ...(rawEntries.map((entry) => entry.name) as BundleEntryName[])],
		eventCount: input.events.length,
		diagnosisCount: input.diagnoses.length,
		includesRawArtifacts: rawEntries.length > 0,
	}

	// Checksums cover every entry except the checksum file itself, which
	// cannot hash its own contents.
	const hashedEntries: BuiltBundleEntry[] = [
		{ name: BUNDLE_ENTRIES.manifest, content: JSON.stringify(manifest, null, 2) },
		{ name: BUNDLE_ENTRIES.events, content: eventsContent },
		{ name: BUNDLE_ENTRIES.diagnoses, content: diagnosesContent },
		{ name: BUNDLE_ENTRIES.scenario, content: scenarioContent },
		{ name: BUNDLE_ENTRIES.environment, content: environmentContent },
		...rawEntries,
	]

	const checksums: Record<string, string> = {}
	for (const entry of hashedEntries) {
		checksums[entry.name] = sha256(entry.content)
	}

	return {
		manifest,
		entries: [...hashedEntries, { name: BUNDLE_ENTRIES.checksums, content: JSON.stringify(checksums, null, 2) }],
		checksums,
	}
}

/**
 * Recompute checksums and report every entry that fails verification.
 *
 * Verification walks three sets — the manifest listing, the actual entries and
 * the checksum table — because content hashing alone cannot detect an entry
 * that was deleted, duplicated, or added after the fact.
 */
export function verifyBundleChecksums(bundle: BuiltBundle): readonly string[] {
	const problems: string[] = []
	const seen = new Set<string>()

	for (const entry of bundle.entries) {
		if (seen.has(entry.name)) {
			problems.push(entry.name)
			continue
		}
		seen.add(entry.name)
		if (entry.name === BUNDLE_ENTRIES.checksums) continue

		const expected = bundle.checksums[entry.name]
		if (expected === undefined || expected !== sha256(entry.content)) {
			problems.push(entry.name)
		}
	}

	// An entry named in the checksum table but missing from the archive is as
	// much a corruption as a content mismatch.
	for (const name of Object.keys(bundle.checksums)) {
		if (!seen.has(name)) problems.push(name)
	}

	// The manifest is the reader-facing catalogue; a divergence between it and
	// the archive means the bundle cannot be trusted even if hashes match.
	const manifestEntries = new Set<string>(bundle.manifest.entries)
	for (const name of manifestEntries) {
		if (!seen.has(name)) problems.push(name)
	}
	for (const name of seen) {
		if (name !== BUNDLE_ENTRIES.checksums && !manifestEntries.has(name)) problems.push(name)
	}

	return [...new Set(problems)]
}
