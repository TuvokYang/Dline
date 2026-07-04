import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.USE_SUBAGENTS

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "use_subagents",
	description: getPrompt("subagent", "description"),
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: [
		{
			name: "prompt_1",
			required: true,
			instruction: getPrompt("subagent", "prompt1Instruction"),
		},
		{
			name: "prompt_2",
			required: false,
			instruction: getPrompt("subagent", "prompt2Instruction"),
		},
		{
			name: "prompt_3",
			required: false,
			instruction: getPrompt("subagent", "prompt3Instruction"),
		},
		{
			name: "prompt_4",
			required: false,
			instruction: getPrompt("subagent", "prompt4Instruction"),
		},
		{
			name: "prompt_5",
			required: false,
			instruction: getPrompt("subagent", "prompt5Instruction"),
		},
	],
}

export const subagent_variants = [generic]
