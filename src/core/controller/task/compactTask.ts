import { type CompactTaskRequest, CompactTaskResponse } from "@shared/proto/dline/task"
import type { Controller } from ".."

/** Handle one task-local context compaction request without consuming an interaction response. */
export async function compactTask(controller: Controller, request: CompactTaskRequest): Promise<CompactTaskResponse> {
	const task = controller.task
	if (!task || task.taskId !== request.taskId) {
		return CompactTaskResponse.create({ accepted: false, result: "missing_task" })
	}

	return CompactTaskResponse.create(await task.compactTask(request.stateRevision))
}
