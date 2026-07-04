import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { SystemPromptContext, TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_EDIT

const getOpenOrVisibleTabPaths = (context: SystemPromptContext) => {
	return [...(context.editorTabs?.open ?? []), ...(context.editorTabs?.visible ?? [])]
}

const shouldIncludeNotebookInstructions = (context: SystemPromptContext) => {
	return getOpenOrVisibleTabPaths(context).some((p) => p.endsWith(".ipynb"))
}

const diffInstruction = (context: SystemPromptContext) => {
	return shouldIncludeNotebookInstructions(context)
		? getPrompt("replaceInFile", "baseDiffInstructions") + getPrompt("replaceInFile", "notebookInstructions")
		: getPrompt("replaceInFile", "baseDiffInstructions")
}

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "replace_in_file",
	description: getPrompt("replaceInFile", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("replaceInFile", "pathInstruction"),
			usage: getPrompt("replaceInFile", "pathUsage"),
		},
		{
			name: "diff",
			required: true,
			instruction: diffInstruction,
			usage: getPrompt("replaceInFile", "diffUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "replace_in_file",
	description: getPrompt("replaceInFile", "nativeDescription"),
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction: getPrompt("replaceInFile", "nativePathInstruction"),
		},
		{
			name: "diff",
			required: true,
			instruction: diffInstruction,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const replace_in_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
