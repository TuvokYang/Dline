import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { WorkspaceFileRegistry } from "./WorkspaceFileRegistry"

/**
 * TaskFileTracker (Per-Task Instance)
 *
 * Tracks file modifications for a single task and bridges to the global
 * WorkspaceFileRegistry for cross-task conflict detection.
 *
 * Each task creates one TaskFileTracker. Tool handlers call
 * `trackModification()` after successfully writing to a file, and the
 * checkpoint manager calls `getModifiedFiles()` to obtain the file list
 * for per-file checkpoint commits.
 *
 * Lifecycle:
 * - Created when a task starts (alongside CheckpointTracker)
 * - Tracks files throughout the task via tool handlers
 * - `dispose()` is called when the task ends, releasing all file ownership
 */
export class TaskFileTracker {
	private taskId: string
	private registry: WorkspaceFileRegistry

	/** Local cache of files modified by this task (lowercased absolute paths) */
	private modifiedFiles = new Set<string>()

	/**
	 * Create a new TaskFileTracker for a task.
	 *
	 * @param taskId - Unique task identifier
	 */
	constructor(taskId: string) {
		this.taskId = taskId
		this.registry = WorkspaceFileRegistry.getInstance()
		Logger.debug(`[TaskFileTracker] Created for task ${taskId}`)
	}

	/**
	 * Record a file modification by this task.
	 * Registers with the global WorkspaceFileRegistry and updates local cache.
	 *
	 * @param filePath - Absolute or relative path to the modified file
	 */
	trackModification(filePath: string): void {
		const normalizedPath = path.resolve(filePath).toLowerCase()

		// Avoid duplicate registrations for the same file
		if (this.modifiedFiles.has(normalizedPath)) {
			return
		}

		this.modifiedFiles.add(normalizedPath)
		this.registry.registerModification(this.taskId, filePath)
		Logger.debug(`[TaskFileTracker] Task ${this.taskId} tracked modification of '${normalizedPath}'`)
	}

	/**
	 * Get all files modified by this task.
	 *
	 * @returns Array of absolute file paths
	 */
	getModifiedFiles(): string[] {
		return Array.from(this.modifiedFiles)
	}

	/**
	 * Clear the local modified files cache after a successful checkpoint commit.
	 * This resets tracking so the next checkpoint only captures newly modified files.
	 * The global WorkspaceFileRegistry is intentionally left untouched — restore
	 * scenarios need the full history of file ownership for per-file restore.
	 */
	clearModifiedFiles(): void {
		this.modifiedFiles.clear()
		Logger.debug(`[TaskFileTracker] Cleared modified files for task ${this.taskId}`)
	}

	/**
	 * Release all file ownership for this task.
	 * Should be called when the task ends (completes, is cancelled, or errors out).
	 */
	dispose(): void {
		// Do NOT release task from the global registry here — restore scenarios
		// (e.g. task terminated then restored from history) need the file list
		// to perform per-file restore. Registry entries are cleaned up by
		// releaseTask() only when explicitly called by external lifecycle hooks.
		this.modifiedFiles.clear()
		Logger.debug(`[TaskFileTracker] Disposed for task ${this.taskId}`)
	}
}
