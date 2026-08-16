import type { SettingsKey } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TaskServiceTierOverride } from "@shared/task-provider-overrides"
import { taskServiceTierOverrideFromFields, taskServiceTierOverrideToFields } from "@shared/task-provider-overrides"
import type { TaskReasoningOverride } from "@shared/task-reasoning"
import { taskReasoningOverrideFromFields, taskReasoningOverrideToFields } from "@shared/task-reasoning"
import type { StateManager } from "../storage/StateManager"

export interface TaskProfileBinding {
	profileId?: string
	profileName?: string
}

/**
 * Per-task state manager that eliminates the activeTaskId indirection.
 * Each Task owns its own TaskStateManager instance with a direct
 * reference to its settings cache — no global routing needed.
 *
 * For persistence, writes are delegated to the global StateManager
 * which handles debounced disk I/O. Reads are always from local cache
 * (O(1), no lock, no activeTaskId).
 */
export class TaskStateManager {
	readonly taskId: string
	private globalSm: StateManager

	/**
	 * Direct reference to this task's entry in StateManager.taskStateCache.
	 * Mutations here are immediately visible to the global StateManager
	 * for persistence (debounced write) and cross-instance reads.
	 */
	private cache: Record<string, any>

	constructor(taskId: string, globalSm: StateManager) {
		this.taskId = taskId
		this.globalSm = globalSm
		// Grab the exact cache entry from the global StateManager.
		// This is the same object used by setTaskSettings / getGlobalSettingsKey,
		// so writes are automatically picked up by the persistence layer.
		this.cache = globalSm.getTaskCacheRef(taskId)
	}

	// ──────────────── mode ────────────────

	/**
	 * Get the current plan/act mode. No activeTaskId routing needed —
	 * reads directly from this task's dedicated cache.
	 */
	get mode(): Mode {
		// Each task owns its mode independently. Never fall back to
		// global state — that would leak mode across windows/tasks.
		return (this.cache.mode as Mode) ?? "plan"
	}

	/**
	 * Set the plan/act mode. Writes to both local cache (instant) and
	 * delegates to global StateManager for debounced disk persistence.
	 */
	setMode(mode: Mode): void {
		this.cache.mode = mode
		// Tell global SM to persist this change (debounced disk write)
		this.globalSm.markTaskSettingDirty(this.taskId, "mode")
	}

	// ──────────────── profiles ────────────────

	/**
	 * Get the plan mode profile. Returns undefined if not set at task level,
	 * allowing fallback to global settings.
	 */
	get planModeProfile(): string | undefined {
		return this.cache.planModeProfile as string | undefined
	}

	/** Return the stable Profile identity bound to plan mode, when available. */
	get planModeProfileId(): string | undefined {
		return this.cache.planModeProfileId as string | undefined
	}

	/**
	 * Set the plan mode profile. Writes to both local cache (instant) and
	 * delegates to global StateManager for debounced disk persistence.
	 */
	setPlanModeProfile(profile: string): void {
		this.cache.planModeProfile = profile
		this.globalSm.markTaskSettingDirty(this.taskId, "planModeProfile")
	}

	/**
	 * Get the act mode profile. Returns undefined if not set at task level,
	 * allowing fallback to global settings.
	 */
	get actModeProfile(): string | undefined {
		return this.cache.actModeProfile as string | undefined
	}

	/** Return the stable Profile identity bound to act mode, when available. */
	get actModeProfileId(): string | undefined {
		return this.cache.actModeProfileId as string | undefined
	}

	/**
	 * Set the act mode profile. Writes to both local cache (instant) and
	 * delegates to global StateManager for debounced disk persistence.
	 */
	setActModeProfile(profile: string): void {
		this.cache.actModeProfile = profile
		this.globalSm.markTaskSettingDirty(this.taskId, "actModeProfile")
	}

	/** Adopt a stable Profile identity and its current display name without rebuilding the handler. */
	adoptProfileIdentity(mode: Mode, profileId: string, profileName: string): void {
		if (mode === "plan") {
			this.cache.planModeProfileId = profileId
			this.cache.planModeProfile = profileName
			this.globalSm.markTaskSettingDirty(this.taskId, "planModeProfileId")
			this.globalSm.markTaskSettingDirty(this.taskId, "planModeProfile")
			return
		}

		this.cache.actModeProfileId = profileId
		this.cache.actModeProfile = profileName
		this.globalSm.markTaskSettingDirty(this.taskId, "actModeProfileId")
		this.globalSm.markTaskSettingDirty(this.taskId, "actModeProfile")
	}

	/** Atomically update stable identity and display name for one or both task-local Profile bindings. */
	setProfileIdentityBindings(bindings: Partial<Record<Mode, TaskProfileBinding | undefined>>): void {
		const apply = (mode: Mode, binding: TaskProfileBinding | undefined) => {
			const idKey = mode === "plan" ? "planModeProfileId" : "actModeProfileId"
			const nameKey = mode === "plan" ? "planModeProfile" : "actModeProfile"
			if (binding?.profileId === undefined) delete this.cache[idKey]
			else this.cache[idKey] = binding.profileId
			if (binding?.profileName === undefined) delete this.cache[nameKey]
			else this.cache[nameKey] = binding.profileName
			this.globalSm.markTaskSettingDirty(this.taskId, idKey)
			this.globalSm.markTaskSettingDirty(this.taskId, nameKey)
		}

		if (Object.hasOwn(bindings, "plan")) apply("plan", bindings.plan)
		if (Object.hasOwn(bindings, "act")) apply("act", bindings.act)
	}

	/** Return the Task-local reasoning override for one mode, including legacy effort migration. */
	getReasoningOverride(mode: Mode): TaskReasoningOverride | undefined {
		const prefix = mode === "plan" ? "planMode" : "actMode"
		return taskReasoningOverrideFromFields(
			{
				kind: this.cache[`${prefix}ReasoningOverrideKind`] as string | undefined,
				effort: this.cache[`${prefix}ReasoningOverrideEffort`] as string | undefined,
				budgetTokens: this.cache[`${prefix}ThinkingBudgetTokens`] as number | undefined,
			},
			this.cache[`${prefix}ReasoningEffort`] as string | undefined,
		)
	}

	/** Persist or clear one mode's Task-local reasoning override. */
	setReasoningOverride(mode: Mode, override: TaskReasoningOverride): void {
		const prefix = mode === "plan" ? "planMode" : "actMode"
		const fields = taskReasoningOverrideToFields(override)
		this.writeOptionalSetting(`${prefix}ReasoningOverrideKind`, fields.kind)
		this.writeOptionalSetting(`${prefix}ReasoningOverrideEffort`, fields.effort)
		this.writeOptionalSetting(`${prefix}ThinkingBudgetTokens`, fields.budgetTokens)
		this.writeOptionalSetting(`${prefix}ReasoningEffort`, undefined)
	}

	/** Return the Task-local OpenAI service tier override for one mode. */
	getServiceTierOverride(mode: Mode): TaskServiceTierOverride | undefined {
		const prefix = mode === "plan" ? "planMode" : "actMode"
		return taskServiceTierOverrideFromFields({
			kind: this.cache[`${prefix}ServiceTierOverrideKind`] as string | undefined,
			tier: this.cache[`${prefix}ServiceTierOverrideTier`] as string | undefined,
		})
	}

	/** Persist or clear one mode's Task-local OpenAI service tier override. */
	setServiceTierOverride(mode: Mode, override: TaskServiceTierOverride): void {
		const prefix = mode === "plan" ? "planMode" : "actMode"
		const fields = taskServiceTierOverrideToFields(override)
		this.writeOptionalSetting(`${prefix}ServiceTierOverrideKind`, fields.kind)
		this.writeOptionalSetting(`${prefix}ServiceTierOverrideTier`, fields.tier)
	}

	private writeOptionalSetting(key: SettingsKey, value: string | number | undefined): void {
		if (value === undefined) delete this.cache[key]
		else this.cache[key] = value
		this.globalSm.markTaskSettingDirty(this.taskId, key)
	}

	/** Update legacy Profile names for compatibility-only transition restore paths. */
	setProfileBindings(bindings: Partial<Record<Mode, string | undefined>>): void {
		if (Object.hasOwn(bindings, "plan")) {
			if (bindings.plan === undefined) delete this.cache.planModeProfile
			else this.cache.planModeProfile = bindings.plan
			this.globalSm.markTaskSettingDirty(this.taskId, "planModeProfile")
		}
		if (Object.hasOwn(bindings, "act")) {
			if (bindings.act === undefined) delete this.cache.actModeProfile
			else this.cache.actModeProfile = bindings.act
			this.globalSm.markTaskSettingDirty(this.taskId, "actModeProfile")
		}
	}

	get taskCapabilityToggles(): string | undefined {
		return this.cache.taskCapabilityToggles as string | undefined
	}

	setTaskCapabilityToggles(toggles: string): void {
		this.cache.taskCapabilityToggles = toggles
		this.globalSm.markTaskSettingDirty(this.taskId, "taskCapabilityToggles")
	}
}
