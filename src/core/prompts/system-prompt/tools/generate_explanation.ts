import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.GENERATE_EXPLANATION

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "generate_explanation",
	description: getPrompt("generateExplanation", "description"),
	contextRequirements: (context) => context.isCliEnvironment !== true,
	parameters: [
		{
			name: "title",
			required: true,
			instruction: getPrompt("generateExplanation", "titleInstruction"),
			usage: getPrompt("generateExplanation", "titleUsage"),
		},
		{
			name: "from_ref",
			required: true,
			instruction: getPrompt("generateExplanation", "fromRefInstruction"),
			usage: getPrompt("generateExplanation", "fromRefUsage"),
		},
		{
			name: "to_ref",
			required: false,
			instruction: getPrompt("generateExplanation", "toRefInstruction"),
			usage: getPrompt("generateExplanation", "toRefUsage"),
		},
	],
}

export const generate_explanation_variants = [GENERIC]
