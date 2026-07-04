import { Empty, StringRequest } from "@shared/proto/dline/common"
import type { Controller } from ".."

/**
 * Force-release the lock on a task so the current instance can take over.
 * After releasing, the current instance acquires the lock and activates
 * the task from read-only mode into full interactive mode.
 *
 * @param controller The controller instance
 * @param request StringRequest wrapping the task ID
 * @returns Empty
 */
export async function forceReleaseTaskLock(controller: Controller, request: StringRequest): Promise<Empty> {
	const taskId = request.value
	if (!taskId) {
		throw new Error("Missing task ID")
	}

	// Force-release the existing lock
	await controller.lockService.forceReleaseTaskLock(taskId)

	// Acquire the lock for this instance
	const acquired = await controller.lockService.acquireTaskLock(taskId)
	if (!acquired) {
		throw new Error("Failed to acquire lock after force release")
	}

	// Activate the task from read-only to interactive mode
	await controller.activateTaskAfterUnlock(taskId)

	return Empty.create()
}
