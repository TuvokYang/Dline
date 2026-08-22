import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { getWorkflowsScanDirectories } from "@core/storage/disk"
import { reconcileGlobalCapabilities } from "@core/storage/settings/global-capability-settings"
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

	const currentLocal = controller.stateManager.getWorkspaceStateKey("workflowToggles") || {}
	const discoveredGlobal: ClineRulesToggles = {}
	const discoveredLocal: ClineRulesToggles = {}

	// Synchronize each directory independently, then merge the discovered paths.
	// Calling synchronizeRuleToggles with an empty map avoids one directory
	// deleting entries discovered from a sibling directory.
	for (const dir of scanDirs) {
		const discovered = await synchronizeRuleToggles(dir.path, {})
		if (dir.source === "global") Object.assign(discoveredGlobal, discovered)
		else Object.assign(discoveredLocal, discovered)
	}

	const globalToggles = await reconcileGlobalCapabilities(controller.stateManager, "globalWorkflowToggles", discoveredGlobal)
	const localToggles: ClineRulesToggles = {}
	for (const [workflowPath, defaultEnabled] of Object.entries(discoveredLocal)) {
		localToggles[workflowPath] = currentLocal[workflowPath] ?? defaultEnabled
	}

	controller.stateManager.setWorkspaceState("workflowToggles", localToggles)

	return {
		globalWorkflowToggles: globalToggles,
		localWorkflowToggles: localToggles,
	}
}
