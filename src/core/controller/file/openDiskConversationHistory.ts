import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/dline/common"
import path from "path"
import { GlobalFileNames, getDlineTasksDir } from "@/core/storage/disk"
import { Controller } from ".."
/**
 * Opens the API conversation history JSONL file for the given task in the editor.
 * @param controller The controller instance
 * @param request The request message containing the task ID in the 'value' field
 * @returns Empty response
 */
export async function openDiskConversationHistory(_controller: Controller, request: StringRequest): Promise<Empty> {
	const tasksDir = await getDlineTasksDir()
	const taskConversationHistoryPath = path.join(tasksDir, request.value, GlobalFileNames.apiConversationHistory)
	if (request.value) {
		openFileIntegration(taskConversationHistoryPath)
	}
	return Empty.create()
}
