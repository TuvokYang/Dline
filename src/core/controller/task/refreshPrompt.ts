import type { RefreshPromptRequest, RefreshPromptResponse } from "@shared/proto/dline/task"
import type { Controller } from ".."

/**
 * Handle manual system prompt cache refresh for an active task.
 * @param controller Controller instance.
 * @param request Refresh request with task ID.
 * @returns Success status.
 */
export async function refreshPrompt(controller: Controller, request: RefreshPromptRequest): Promise<RefreshPromptResponse> {
	const task = controller.task
	if (!task || task.taskId !== request.taskId) {
		return { success: false }
	}
	await task.manualRefreshPrompt()
	return { success: true }
}
