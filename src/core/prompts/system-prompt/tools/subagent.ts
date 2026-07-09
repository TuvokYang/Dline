import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const singleGeneric: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.USE_SUBAGENT,
	name: "use_subagent",
	description: "Use one named YAML subagent for a focused task.",
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: [
		{
			name: "subagent_name",
			required: true,
			instruction: "Name of the YAML subagent to run.",
		},
		{
			name: "task",
			required: true,
			instruction: "Short task title for the selected subagent.",
		},
		{
			name: "content",
			required: true,
			instruction: "Detailed task context and instructions for the selected subagent.",
		},
		{
			name: "background",
			required: false,
			instruction: "Optional boolean. Set true to run in background. Defaults to false.",
		},
		{
			name: "timeout",
			required: false,
			instruction: "Optional positive integer timeout in seconds. Defaults to 600.",
		},
	],
}

const batchGeneric: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.USE_SUBAGENTS,
	name: "use_subagents",
	description: getPrompt("subagent", "description"),
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: [
		{
			name: "prompt_1",
			required: true,
			instruction: `${getPrompt("subagent", "prompt1Instruction")} Must include <task> and <context> sections.`,
		},
		{
			name: "prompt_2",
			required: false,
			instruction: `${getPrompt("subagent", "prompt2Instruction")} Must include <task> and <context> sections when provided.`,
		},
		{
			name: "prompt_3",
			required: false,
			instruction: `${getPrompt("subagent", "prompt3Instruction")} Must include <task> and <context> sections when provided.`,
		},
		{
			name: "prompt_4",
			required: false,
			instruction: `${getPrompt("subagent", "prompt4Instruction")} Must include <task> and <context> sections when provided.`,
		},
		{
			name: "prompt_5",
			required: false,
			instruction: `${getPrompt("subagent", "prompt5Instruction")} Must include <task> and <context> sections when provided.`,
		},
		{
			name: "background",
			required: false,
			instruction: "Optional boolean. Set true to run the batch in background. Defaults to false.",
		},
		{
			name: "timeout",
			required: false,
			instruction: "Optional positive integer timeout in seconds for each subagent. Defaults to 600.",
		},
	],
}

export const subagent_variants = [singleGeneric, batchGeneric]
