import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.USE_SKILL

const generic: ClineToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "use_skill",
	description: getPrompt("useSkill", "description"),
	contextRequirements: (context) => context.skills !== undefined && context.skills.length > 0,
	parameters: [
		{
			name: "skill_name",
			required: true,
			instruction: getPrompt("useSkill", "skillNameInstruction"),
		},
	],
}

export const use_skill_variants = [generic]
