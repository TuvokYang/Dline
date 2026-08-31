import { refreshClineRulesToggles } from "@core/context/instructions/user-instructions/cline-rules"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import { refreshWorkflowToggles } from "@core/context/instructions/user-instructions/workflows"
import { EmptyRequest } from "@shared/proto/dline/common"
import { RefreshedDlineToggles } from "@shared/proto/dline/file"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from "../index"
import { coalesceCapabilityScan } from "./refresh-coalescing"
import { refreshSkills } from "./refreshSkills"

/**
 * Refreshes all dline toggles (Cline rules, external rules, workflows, and skills)
 *
 * The capability panel polls this on a short timer while task startup and state
 * publishes trigger it again, so concurrent callers share one in-flight scan
 * instead of each walking the workspace.
 *
 * @param controller The controller instance
 * @param _request The empty request
 * @returns RefreshedDlineToggles containing updated toggles for all types
 */
export function refreshRules(controller: Controller, _request: EmptyRequest): Promise<RefreshedDlineToggles> {
	return coalesceCapabilityScan(controller, "rules", () => scanRules(controller))
}

async function scanRules(controller: Controller): Promise<RefreshedDlineToggles> {
	const startedAt = performance.now()
	try {
		const cwd = await getCwd(getDesktopDir())
		const cwdMs = Math.round(performance.now() - startedAt)
		let stageStartedAt = performance.now()
		const { globalToggles, localToggles } = await refreshClineRulesToggles(controller, cwd)
		const dlineRulesMs = Math.round(performance.now() - stageStartedAt)
		stageStartedAt = performance.now()
		const { cursorLocalToggles, windsurfLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
			controller,
			cwd,
		)
		const externalRulesMs = Math.round(performance.now() - stageStartedAt)
		stageStartedAt = performance.now()
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(controller, cwd)
		const workflowsMs = Math.round(performance.now() - stageStartedAt)
		stageStartedAt = performance.now()
		const { globalSkills, localSkills } = await refreshSkills(controller)
		const skillsMs = Math.round(performance.now() - stageStartedAt)
		Logger.debug(
			`[CapabilityPerf] phase=rules_refresh_rpc taskId=${controller.task?.taskId ?? "none"} cwdMs=${cwdMs} dlineRulesMs=${dlineRulesMs} externalRulesMs=${externalRulesMs} workflowsMs=${workflowsMs} skillsMs=${skillsMs} totalMs=${Math.round(performance.now() - startedAt)} dlineRules=${Object.keys(globalToggles).length + Object.keys(localToggles).length} externalRules=${Object.keys(cursorLocalToggles).length + Object.keys(windsurfLocalToggles).length + Object.keys(agentsLocalToggles).length} workflows=${Object.keys(localWorkflowToggles).length + Object.keys(globalWorkflowToggles).length} skills=${globalSkills.length + localSkills.length}`,
		)

		return RefreshedDlineToggles.create({
			globalClineRulesToggles: { toggles: globalToggles },
			localClineRulesToggles: { toggles: localToggles },
			localCursorRulesToggles: { toggles: cursorLocalToggles },
			localWindsurfRulesToggles: { toggles: windsurfLocalToggles },
			localAgentsRulesToggles: { toggles: agentsLocalToggles },
			localWorkflowToggles: { toggles: localWorkflowToggles },
			globalWorkflowToggles: { toggles: globalWorkflowToggles },
			localSkillsToggles: { toggles: buildSkillToggles(localSkills) },
			globalSkillsToggles: { toggles: buildSkillToggles(globalSkills) },
		})
	} catch (error) {
		Logger.error("Failed to refresh rules:", error)
		Logger.debug(
			`[CapabilityPerf] phase=rules_refresh_rpc_error taskId=${controller.task?.taskId ?? "none"} totalMs=${Math.round(performance.now() - startedAt)}`,
		)
		throw error
	}
}

/**
 * Build a ClineRulesToggles map from SkillInfo array.
 * Maps skill name → enabled state (name from frontmatter, not file path).
 */
function buildSkillToggles(skills: { name: string; path: string; enabled: boolean }[]): Record<string, boolean> {
	const toggles: Record<string, boolean> = {}
	for (const skill of skills) {
		if (!skill.path.startsWith("remote:")) toggles[skill.path] = skill.enabled
	}
	return toggles
}
