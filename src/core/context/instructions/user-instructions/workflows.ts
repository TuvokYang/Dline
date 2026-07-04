import { combineRuleToggles, synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { getWorkflowsScanDirectories } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { Controller } from "@/core/controller"

/**
 * Refresh the workflow toggles.
 * Scans multiple directories:
 *   - Project: .agents/workflows/ (new) + .clinerules/workflows/ (legacy compat)
 *   - Global:  ~/Documents/dline/workflows/
 */
export async function refreshWorkflowToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	const scanDirs = getWorkflowsScanDirectories(workingDirectory)

	let globalToggles: ClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles") || {}
	let localToggles: ClineRulesToggles = controller.stateManager.getWorkspaceStateKey("workflowToggles") || {}

	for (const dir of scanDirs) {
		const updatedToggles = await synchronizeRuleToggles(dir.path, dir.source === "global" ? globalToggles : localToggles)
		if (dir.source === "global") {
			globalToggles = combineRuleToggles(globalToggles, updatedToggles)
		} else {
			localToggles = combineRuleToggles(localToggles, updatedToggles)
		}
	}

	controller.stateManager.setGlobalState("globalWorkflowToggles", globalToggles)
	controller.stateManager.setWorkspaceState("workflowToggles", localToggles)

	return {
		globalWorkflowToggles: globalToggles,
		localWorkflowToggles: localToggles,
	}
}
