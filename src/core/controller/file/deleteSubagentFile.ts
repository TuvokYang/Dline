import { DeleteSubagentRequest, SubagentToggles } from "@shared/proto/dline/file"
import fs from "fs/promises"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { Controller } from ".."

/**
 * Deletes an existing subagent YAML file.
 * @param controller The controller instance
 * @param request The request containing subagent path and isGlobal flag
 * @returns The updated subagent toggles
 */
export async function deleteSubagentFile(controller: Controller, request: DeleteSubagentRequest): Promise<SubagentToggles> {
	const { subagentPath, isGlobal } = request

	if (!subagentPath || typeof isGlobal !== "boolean") {
		Logger.error("deleteSubagentFile: Missing or invalid parameters", { subagentPath, isGlobal })
		throw new Error("Missing or invalid parameters for deleteSubagentFile")
	}

	// Check if file exists
	const fileExists = await fileExistsAtPath(subagentPath)
	if (!fileExists) {
		throw new Error(`Subagent file does not exist: ${subagentPath}`)
	}

	// Delete the file from disk
	await fs.rm(subagentPath, { force: true })

	// Update the appropriate toggles
	let globalToggles: Record<string, boolean> = {}
	let localToggles: Record<string, boolean> = {}

	if (isGlobal) {
		globalToggles = controller.stateManager.getGlobalSettingsKey("globalSubagentsToggles") || {}
		delete globalToggles[subagentPath]
		controller.stateManager.setGlobalState("globalSubagentsToggles", globalToggles)
	} else {
		localToggles = controller.stateManager.getWorkspaceStateKey("localSubagentsToggles") || {}
		delete localToggles[subagentPath]
		controller.stateManager.setWorkspaceState("localSubagentsToggles", localToggles)
	}

	return SubagentToggles.create({
		globalSubagentsToggles: globalToggles,
		localSubagentsToggles: localToggles,
	})
}
