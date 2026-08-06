import { MoveCommandToBackgroundRequest, MoveCommandToBackgroundResponse } from "@shared/proto/dline/task"
import type { Controller } from ".."

/** Move a synchronous foreground command to background tracking. */
export async function moveCommandToBackground(
	controller: Controller,
	request: MoveCommandToBackgroundRequest,
): Promise<MoveCommandToBackgroundResponse> {
	const task = controller.task
	if (!task || task.taskId !== request.taskId || !request.activityId) {
		return MoveCommandToBackgroundResponse.create({ moved: false })
	}
	const moved = await task.moveCommandToBackground(request.activityId)
	return MoveCommandToBackgroundResponse.create({ moved })
}
