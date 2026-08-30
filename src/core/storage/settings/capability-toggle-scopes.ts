import type { ClineRulesToggles } from "@shared/cline-rules"

/**
 * Preference scopes for capability toggles (skills / workflows / rules / subagents).
 *
 * The active scope follows the editor: without an open workspace only "global"
 * exists, an open workspace selects "workspace", and entering a task selects
 * "task". A scope that has not been entered yet simply inherits the level above.
 */
export type CapabilityScope = "global" | "workspace" | "task"

/**
 * Toggle preferences per scope. Each map is a sparse override: a path is present
 * only when the user explicitly changed it at that level, so an absent path
 * means "inherit", never "disabled".
 */
export interface ScopedToggles {
	readonly global?: Readonly<ClineRulesToggles>
	readonly workspace?: Readonly<ClineRulesToggles>
	readonly task?: Readonly<ClineRulesToggles>
}

/** Ordered from the weakest to the strongest override. */
const SCOPE_PRECEDENCE: readonly CapabilityScope[] = ["global", "workspace", "task"]

/**
 * Select the scope that owns a new explicit preference.
 *
 * Discovery never calls this: it only reports what exists on disk. Writing a
 * preference is always an explicit user action against exactly one scope.
 */
export function activeCapabilityScope(context: { hasWorkspace: boolean; hasTask: boolean }): CapabilityScope {
	if (context.hasTask) return "task"
	if (context.hasWorkspace) return "workspace"
	return "global"
}

/**
 * Resolve the effective enabled state for every discovered capability.
 *
 * `discovered` is the read-only scan result and carries the default state for
 * paths no scope has an opinion about. Resolution never mutates its inputs and
 * never persists anything, which keeps discovery off the storage write path.
 */
export function resolveToggles(discovered: Readonly<ClineRulesToggles>, scopes: ScopedToggles = {}): ClineRulesToggles {
	const resolved: ClineRulesToggles = {}

	for (const [resourcePath, defaultEnabled] of Object.entries(discovered)) {
		resolved[resourcePath] = resolveToggle(resourcePath, defaultEnabled, scopes)
	}

	return resolved
}

/** Resolve one capability through the scope chain, falling back to its discovered default. */
export function resolveToggle(resourcePath: string, defaultEnabled: boolean, scopes: ScopedToggles = {}): boolean {
	for (let index = SCOPE_PRECEDENCE.length - 1; index >= 0; index--) {
		const override = scopes[SCOPE_PRECEDENCE[index]]?.[resourcePath]
		if (override !== undefined) return override
	}
	return defaultEnabled
}

/**
 * Build the sparse override map to persist after an explicit toggle change.
 *
 * Only the changed path is recorded, so unrelated capabilities keep inheriting
 * from the scope above instead of being frozen at their current effective value.
 */
export function withToggleOverride(
	current: Readonly<ClineRulesToggles> | undefined,
	resourcePath: string,
	enabled: boolean,
): ClineRulesToggles {
	return { ...(current ?? {}), [resourcePath]: enabled }
}

/**
 * Drop one explicit override so the capability inherits from the scope above again.
 */
export function withoutToggleOverride(current: Readonly<ClineRulesToggles> | undefined, resourcePath: string): ClineRulesToggles {
	const { [resourcePath]: _removed, ...remaining } = current ?? {}
	return remaining
}
