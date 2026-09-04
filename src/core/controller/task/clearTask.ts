import { Empty, EmptyRequest } from "@shared/proto/dline/common"
import { Controller } from ".."

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// clearTask is called here when the user closes the task.
	// Closing only ends the session: a Task that already established a
	// completion verdict keeps it, so reopening it from history does not
	// present finished work as unfinished.
	await controller.clearTask({ clearPanelState: true, preserveCompletedState: true })
	await controller.postStateToWebview()
	return Empty.create()
}
