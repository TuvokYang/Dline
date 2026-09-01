import type { ClineRulesToggles } from "@shared/cline-rules"
import type { LocalStateKey } from "@shared/storage/state-keys"
import { Logger } from "@/shared/services/Logger"
import { capabilityResourceId } from "./capability-resource-id"
import type { CapabilityKind } from "./capability-toggle-store"

/**
 * Marker recording the highest key-normalization generation already applied to
 * the workspace preference document.
 *
 * A boolean could not repair a document that a later defect polluted again, so
 * the marker carries a generation and the migration reruns whenever
 * CAPABILITY_KEY_NORMALIZATION_GENERATION is raised.
 */
export const CAPABILITY_KEY_NORMALIZATION_GENERATION_KEY = "__capabilityKeyNormalizationGeneration"

/** Raise this when a new defect makes another normalization pass necessary. */
export const CAPABILITY_KEY_NORMALIZATION_GENERATION = 1

/** Legacy workspace-state maps and the capability kind that now owns them. */
const LEGACY_LOCAL_TOGGLE_KEYS: ReadonlyArray<readonly [key: LocalStateKey, kind: CapabilityKind]> = [
	["localClineRulesToggles", "rules"],
	["localCursorRulesToggles", "cursorRules"],
	["localWindsurfRulesToggles", "windsurfRules"],
	["localAgentsRulesToggles", "agentsRules"],
	["localSkillsToggles", "skills"],
	["localSubagentsToggles", "subagents"],
	["workflowToggles", "workflows"],
	["mcpServersToggles", "mcp"],
]

/** Minimal view of the state manager this migration needs. */
export interface LegacyToggleSource {
	getWorkspaceStateKey(key: LocalStateKey): Record<string, boolean> | undefined
}

/** One capability kind's normalized overrides, ready to merge into the workspace scope. */
export interface LegacyToggleMigration {
	readonly kind: CapabilityKind
	readonly overrides: ClineRulesToggles
}

/**
 * Convert the legacy full-state maps into sparse overrides.
 *
 * The legacy maps stored every discovered path, including the ones the user
 * never touched. Carrying those over would freeze today's scan result as an
 * explicit preference and defeat inheritance, so only entries that differ from
 * the discovery default (enabled) are treated as a real user decision.
 *
 * Paths are normalized through `capabilityResourceId` so an override survives
 * separator and case differences between launches — the exact drift that used
 * to make toggles reappear as enabled after an update.
 */
export function planLegacyToggleMigration(source: LegacyToggleSource): LegacyToggleMigration[] {
	const migrations: LegacyToggleMigration[] = []

	for (const [key, kind] of LEGACY_LOCAL_TOGGLE_KEYS) {
		const legacy = source.getWorkspaceStateKey(key)
		if (!legacy) continue

		const overrides: ClineRulesToggles = {}
		for (const [resourcePath, enabled] of Object.entries(legacy)) {
			if (enabled !== false) continue
			const id = capabilityResourceId(resourcePath)
			if (id === "") continue
			overrides[id] = false
		}

		if (Object.keys(overrides).length > 0) {
			migrations.push({ kind, overrides })
		}
	}

	if (migrations.length > 0) {
		Logger.debug(
			`[CapabilityToggleMigration] Planned ${migrations.length} kinds: ${migrations
				.map((migration) => `${migration.kind}=${Object.keys(migration.overrides).length}`)
				.join(" ")}`,
		)
	}

	return migrations
}

/**
 * Merge migrated overrides into an existing workspace map.
 *
 * An existing override was written by a build that already understands the
 * scope chain, so it wins over the legacy value.
 */
export function mergeMigratedOverrides(
	current: Readonly<ClineRulesToggles> | undefined,
	migrated: Readonly<ClineRulesToggles>,
): ClineRulesToggles {
	return { ...migrated, ...(current ?? {}) }
}
