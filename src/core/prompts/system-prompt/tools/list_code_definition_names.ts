import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.LIST_CODE_DEF

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "list_code_definition_names",
	description: getPrompt("listCodeDefinitionNames", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("listCodeDefinitionNames", "pathInstruction"),
			usage: getPrompt("listCodeDefinitionNames", "pathUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "list_code_definition_names",
	description: getPrompt("listCodeDefinitionNames", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("listCodeDefinitionNames", "pathInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const list_code_definition_names_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
