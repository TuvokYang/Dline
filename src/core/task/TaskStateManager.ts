import type { Mode } from "@shared/storage/types"
import type { StateManager } from "../storage/StateManager"

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
}
