import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { getWorkflowsScanDirectories } from "@core/storage/disk"
import { resolveCapabilityToggles } from "@core/storage/settings/capability-toggle-store"
import { ClineRulesToggles } from "@shared/cline-rules"
import { Logger } from "@shared/services/Logger"
import { Controller } from "@/core/controller"

/**
 * Refresh the workflow toggles.
 * Scans multiple directories:
 *   - Project: .agents/workflows/ (new) + .clinerules/workflows/ (legacy compat)
 *   - Global:  ~/Documents/dline/workflows/
 *
 * Discovery is read-only: it reports what exists on disk and resolves the
 * effective state against stored preferences in memory. Persisting a preference
 * is reserved for explicit user toggles, so this stays off the storage write
 * path and never contends for the cross-process settings lock.
 */
export async function refreshWorkflowToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	const startedAt = performance.now()
	const scanDirs = getWorkflowsScanDirectories(workingDirectory)

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

	// Global entries resolve through the same scope chain as project entries, so a
	// workspace or task override applies to both.
	const globalToggles = resolveCapabilityToggles(controller.stateManager, "workflows", discoveredGlobal)
	const localToggles = resolveCapabilityToggles(controller.stateManager, "workflows", discoveredLocal)
	Logger.debug(
		`[CapabilityPerf] phase=workflows_refresh taskId=${controller.task?.taskId ?? "none"} durationMs=${Math.round(performance.now() - startedAt)} directories=${scanDirs.length} global=${Object.keys(globalToggles).length} local=${Object.keys(localToggles).length}`,
	)

	return {
		globalWorkflowToggles: globalToggles,
		localWorkflowToggles: localToggles,
	}
}
