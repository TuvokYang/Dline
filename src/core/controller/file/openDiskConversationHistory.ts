import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import path from "path"
import { getDlineTasksDir } from "@/core/storage/disk"
import { Controller } from ".."
/**
 * Opens a file in the editor
 * @param controller The controller instance
 * @param request The request message containing the file path in the 'value' field
 * @returns Empty response
 */
export async function openDiskConversationHistory(_controller: Controller, request: StringRequest): Promise<Empty> {
	const tasksDir = await getDlineTasksDir()
	const taskConversationHistoryPath = path.join(tasksDir, request.value, "api_conversation_history.json")
	if (request.value) {
		openFileIntegration(taskConversationHistoryPath)
	}
	return Empty.create()
}
