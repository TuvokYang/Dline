import path from "node:path"
import fs from "fs/promises"
import { OrchestratorController } from "@/core/orchestrator/OrchestratorController"
import { GlobalFileNames, getDlineCheckpointsDir, getDlineTasksDir } from "@/core/storage/disk"
import { WebviewProviderRegistry } from "@/core/webview/WebviewProviderRegistry"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "../../../utils/fs"
import type { TaskLockService } from "../../locks/TaskLockService"
import type { Controller } from ".."

/**
 * Result of deleting a single task.
 */
interface DeleteSingleResult {
	success: boolean
	taskId: string
	skippedLocked: boolean
	error?: string
}

/**
 * Aggregate result of a batch deletion.
 */
export interface TaskDeletionResult {
	totalRequested: number
	deleted: number
	failed: number
	skippedLocked: number
	failedIds: string[]
	lockedIds: string[]
}

/**
 * Orchestrates the deletion of tasks with lock checking, state cleanup,
 * and file removal.  Separated from the gRPC handler so that the handler
 * only deals with proto serialisation / deserialisation.
 */
interface TaskDeletionDeps {
	getControllerForTask?: (taskId: string) => Controller | undefined
}

export class TaskDeletionOrchestrator {
	constructor(
		private controller: Controller,
		private lockService: TaskLockService,
		private deps: TaskDeletionDeps = {},
	) {}

	/**
	 * Delete a batch of tasks.  Each task is processed independently;
	 * a failure in one task does not stop the others.
	 */
	async deleteBatch(taskIds: string[]): Promise<TaskDeletionResult> {
		const result: TaskDeletionResult = {
			totalRequested: taskIds.length,
			deleted: 0,
			failed: 0,
			skippedLocked: 0,
			failedIds: [],
			lockedIds: [],
		}

		for (const taskId of taskIds) {
			const single = await this.deleteSingle(taskId)
			if (single.skippedLocked) {
				result.skippedLocked++
				result.lockedIds.push(taskId)
			} else if (single.success) {
				result.deleted++
			} else {
				result.failed++
				result.failedIds.push(taskId)
			}
		}

		return result
	}

	/**
	 * Delete a single task following the ordered phases:
	 *   1. Check lock
	 *   2. Clear active task if it matches
	 *   3. Remove from state (handles zombie tasks gracefully)
	 *   4. Delete files and empty directory
	 *   5. If no tasks remain, clean up global directories
	 */
	async deleteSingle(taskId: string): Promise<DeleteSingleResult> {
		// Phase 1: Lock check
		const lockStatus = await this.lockService.checkTaskLock(taskId)
		if (lockStatus.isLocked) {
			const releasedLocalLock = await this.releaseLocalTaskLock(taskId)
			if (!releasedLocalLock) {
				Logger.debug(`[TaskDeletion] Task ${taskId} locked by ${lockStatus.lockedBy} - skipping`)
				return { success: false, taskId, skippedLocked: true }
			}
		}

		try {
			// Phase 2: Clear active task on this controller
			if (taskId === this.controller.task?.taskId) {
				await this.controller.clearTask({ clearPanelState: true })
				Logger.debug(`[TaskDeletion] Cleared active task ${taskId}`)
			}

			// Phase 2b: Close any editor tab panel that is showing this task
			this.closePanelsForTask(taskId)

			// Phase 3: Resolve task (zombie task = file missing)
			let taskPaths: Awaited<ReturnType<typeof this.controller.getTaskWithId>> | undefined
			try {
				taskPaths = await this.controller.getTaskWithId(taskId)
			} catch {
				Logger.debug(`[TaskDeletion] Task ${taskId} is a zombie - state cleaned`)
				return { success: true, taskId, skippedLocked: false }
			}

			// Phase 4: Remove from state
			const updatedTaskHistory = await this.controller.deleteTaskFromState(taskId)

			// Phase 5: Delete files
			const taskDatabasePath = path.join(taskPaths.taskDirPath, GlobalFileNames.taskDatabase(taskId))
			const filePaths = [
				taskPaths.apiConversationHistoryFilePath,
				taskPaths.uiMessagesFilePath,
				taskPaths.contextHistoryFilePath,
				taskPaths.taskMetadataFilePath,
				path.join(taskPaths.taskDirPath, GlobalFileNames.taskActivities),
				path.join(taskPaths.taskDirPath, GlobalFileNames.taskApiRateMetrics),
				taskDatabasePath,
				`${taskDatabasePath}-wal`,
				`${taskDatabasePath}-shm`,
			]
			for (const fp of filePaths) {
				try {
					await fs.rm(fp, { force: true })
				} catch {
					/* already gone */
				}
			}

			try {
				await fs.rmdir(taskPaths.taskDirPath)
			} catch {
				/* not empty */
			}

			// Phase 5b: Release file ownership in the global checkpoint registry.
			// Covers non-active tasks where clearTask() (which normally handles
			// this) was not called because the task didn't match the active one.
			try {
				const { WorkspaceFileRegistry } = await import("@integrations/checkpoints/WorkspaceFileRegistry")
				WorkspaceFileRegistry.getInstance().releaseTask(taskId)
			} catch {
				// Best-effort: registry cleanup failure must not block deletion
			}

			// Phase 6: Global cleanup
			if (updatedTaskHistory.length === 0) {
				const tasksDir = await getDlineTasksDir()
				const checkpointsDir = await getDlineCheckpointsDir()
				if (await fileExistsAtPath(tasksDir)) {
					await fs.rm(tasksDir, { recursive: true, force: true })
				}
				if (await fileExistsAtPath(checkpointsDir)) {
					await fs.rm(checkpointsDir, { recursive: true, force: true })
				}
			}

			return { success: true, taskId, skippedLocked: false }
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			Logger.error(`[TaskDeletion] Failed to delete ${taskId}: ${msg}`)
			return { success: false, taskId, skippedLocked: false, error: msg }
		}
	}

	/**
	 * Release a lock held by a controller in this extension process.
	 *
	 * @param taskId The locked task identifier.
	 * @returns True when a local controller owned and released the lock.
	 */
	private async releaseLocalTaskLock(taskId: string): Promise<boolean> {
		const localController = this.findLocalController(taskId)
		if (!localController) {
			return false
		}

		await localController.clearTask({ clearPanelState: true })
		await this.lockService.releaseTaskLock(taskId)
		Logger.debug(`[TaskDeletion] Released local lock for task ${taskId}`)
		return true
	}

	/**
	 * Find a controller in this extension process that owns the task.
	 *
	 * @param taskId The task identifier to resolve.
	 * @returns The local controller when it is known in this process.
	 */
	private findLocalController(taskId: string): Controller | undefined {
		if (this.controller.task?.taskId === taskId) {
			return this.controller
		}
		return this.deps.getControllerForTask?.(taskId) ?? this.findRegisteredController(taskId)
	}

	/**
	 * Resolve a registered controller without requiring orchestrator setup in tests.
	 *
	 * @param taskId The task identifier to resolve.
	 * @returns The registered controller when the orchestrator is initialized.
	 */
	private findRegisteredController(taskId: string): Controller | undefined {
		try {
			return OrchestratorController.getInstance().getController(taskId)
		} catch {
			return undefined
		}
	}

	/**
	 * Closes any editor tab panels that are displaying the given task.
	 * This prevents orphaned panels from showing a deleted task.
	 *
	 * @param taskId - The ID of the task being deleted
	 */
	private closePanelsForTask(taskId: string): void {
		const panels = WebviewProviderRegistry.getPanels()
		for (const provider of panels) {
			try {
				if (provider.hasController() && provider.controller.task?.taskId === taskId) {
					Logger.debug(`[TaskDeletion] Closing panel for deleted task ${taskId}`)
					provider.dispose()
				}
			} catch (error) {
				Logger.warn(`[TaskDeletion] Error closing panel for task ${taskId}:`, error)
			}
		}
	}
}
