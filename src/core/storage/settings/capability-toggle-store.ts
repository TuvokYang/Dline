import type { StateManager } from "@core/storage/StateManager"
import type { ClineRulesToggles } from "@shared/cline-rules"
import type { SettingsKey } from "@shared/storage/state-keys"
import {
	activeCapabilityScope,
	type CapabilityScope,
	resolveToggles,
	type ScopedToggles,
	withoutToggleOverride,
	withToggleOverride,
} from "./capability-toggle-scopes"

/**
 * The capability families that carry per-scope toggles.
 *
 * "rules" covers Dline's own rule files. Editor-specific rule families keep
 * their own kind because they are discovered from different directories and a
 * user disabling a Cursor rule must not affect a Dline rule with the same name.
 */
export type CapabilityKind =
	| "rules"
	| "workflows"
	| "skills"
	| "subagents"
	| "cursorRules"
	| "windsurfRules"
	| "agentsRules"
	| "mcp"

/** Settings keys holding the sparse override map for one capability kind per scope. */
const SCOPE_KEYS: Record<CapabilityKind, Record<CapabilityScope, SettingsKey>> = {
	rules: {
		global: "globalClineRulesToggles",
		workspace: "workspaceRulesToggles",
		task: "taskRulesToggles",
	},
	workflows: {
		global: "globalWorkflowToggles",
		workspace: "workspaceWorkflowToggles",
		task: "taskWorkflowToggles",
	},
	skills: {
		global: "globalSkillsToggles",
		workspace: "workspaceSkillsToggles",
		task: "taskSkillsToggles",
	},
	subagents: {
		global: "globalSubagentsToggles",
		workspace: "workspaceSubagentsToggles",
		task: "taskSubagentsToggles",
	},
	cursorRules: {
		global: "globalCursorRulesToggles",
		workspace: "workspaceCursorRulesToggles",
		task: "taskCursorRulesToggles",
	},
	windsurfRules: {
		global: "globalWindsurfRulesToggles",
		workspace: "workspaceWindsurfRulesToggles",
		task: "taskWindsurfRulesToggles",
	},
	agentsRules: {
		global: "globalAgentsRulesToggles",
		workspace: "workspaceAgentsRulesToggles",
		task: "taskAgentsRulesToggles",
	},
	mcp: {
		global: "globalMcpToggles",
		workspace: "workspaceMcpToggles",
		task: "taskMcpToggles",
	},
}

/**
 * Read the stored overrides of one capability kind for every scope.
 *
 * This is a pure read: it returns sparse override maps, never the effective
 * state, so callers resolve them against a discovery result.
 */
export function readScopedToggles(stateManager: StateManager, kind: CapabilityKind): ScopedToggles {
	const keys = SCOPE_KEYS[kind]
	return {
		global: stateManager.getScopedCapabilityToggles("global", keys.global) as ClineRulesToggles,
		workspace: stateManager.getScopedCapabilityToggles("workspace", keys.workspace) as ClineRulesToggles,
		task: stateManager.getScopedCapabilityToggles("task", keys.task) as ClineRulesToggles,
	}
}

/**
 * Resolve the effective enabled state of one capability kind against its
 * discovery result, applying global → workspace → task precedence.
 */
export function resolveCapabilityToggles(
	stateManager: StateManager,
	kind: CapabilityKind,
	discovered: Readonly<ClineRulesToggles>,
): ClineRulesToggles {
	return resolveToggles(discovered, readScopedToggles(stateManager, kind))
}

/**
 * Persist one explicit user toggle into the scope that is currently active.
 *
 * The active scope follows the editor: without an open workspace only "global"
 * exists, an open workspace selects "workspace", and entering a task selects
 * "task". Only the changed path is recorded, so every other capability keeps
 * inheriting from the scope above.
 */
export async function setCapabilityEnabled(
	stateManager: StateManager,
	kind: CapabilityKind,
	context: { hasWorkspace: boolean; hasTask: boolean },
	resourcePath: string,
	enabled: boolean,
): Promise<ClineRulesToggles> {
	const scope = activeCapabilityScope(context)
	const key = SCOPE_KEYS[kind][scope]
	return (await stateManager.mutateScopedCapabilityToggles(scope, key, (current) =>
		withToggleOverride(current as ClineRulesToggles, resourcePath, enabled),
	)) as ClineRulesToggles
}

/**
 * Drop one explicit override so the capability inherits from the scope above again.
 */
export async function clearCapabilityOverride(
	stateManager: StateManager,
	kind: CapabilityKind,
	scope: CapabilityScope,
	resourcePath: string,
): Promise<ClineRulesToggles> {
	const key = SCOPE_KEYS[kind][scope]
	return (await stateManager.mutateScopedCapabilityToggles(scope, key, (current) =>
		withoutToggleOverride(current as ClineRulesToggles, resourcePath),
	)) as ClineRulesToggles
}
