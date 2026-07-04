import { SubagentToggles, ToggleSubagentRequest } from "@shared/proto/dline/file"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Toggles a subagent on or off.
 * @param controller The controller instance
 * @param request The request containing the subagent path and enabled state
 * @returns The updated subagent toggles
 */
export async function toggleSubagent(controller: Controller, request: ToggleSubagentRequest): Promise<SubagentToggles> {
	const { subagentPath, isGlobal, enabled } = request

	if (!subagentPath || typeof enabled !== "boolean") {
		Logger.error("toggleSubagent: Missing or invalid parameters", { subagentPath, enabled })
		throw new Error("Missing or invalid parameters for toggleSubagent")
	}

	let globalToggles: Record<string, boolean> = {}
	let localToggles: Record<string, boolean> = {}

	if (isGlobal) {
		globalToggles = controller.stateManager.getGlobalSettingsKey("globalSubagentsToggles") || {}
		globalToggles[subagentPath] = enabled
		controller.stateManager.setGlobalState("globalSubagentsToggles", globalToggles)
	} else {
		localToggles = controller.stateManager.getWorkspaceStateKey("localSubagentsToggles") || {}
		localToggles[subagentPath] = enabled
		controller.stateManager.setWorkspaceState("localSubagentsToggles", localToggles)
	}

	return SubagentToggles.create({
		globalSubagentsToggles: globalToggles,
		localSubagentsToggles: localToggles,
	})
}
