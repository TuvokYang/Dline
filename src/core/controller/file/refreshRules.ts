import { refreshClineRulesToggles } from "@core/context/instructions/user-instructions/cline-rules"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import { refreshWorkflowToggles } from "@core/context/instructions/user-instructions/workflows"
import { EmptyRequest } from "@shared/proto/dline/common"
import { RefreshedDlineToggles } from "@shared/proto/dline/file"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from "../index"
import { refreshSkills } from "./refreshSkills"

/**
 * Refreshes all dline toggles (Cline rules, external rules, workflows, and skills)
 * @param controller The controller instance
 * @param _request The empty request
 * @returns RefreshedDlineToggles containing updated toggles for all types
 */
export async function refreshRules(controller: Controller, _request: EmptyRequest): Promise<RefreshedDlineToggles> {
	try {
		const cwd = await getCwd(getDesktopDir())
		const { globalToggles, localToggles } = await refreshClineRulesToggles(controller, cwd)
		const { cursorLocalToggles, windsurfLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
			controller,
			cwd,
		)
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(controller, cwd)
		const { globalSkills, localSkills } = await refreshSkills(controller)

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
