import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_NEW

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "write_to_file",
	description: getPrompt("writeToFile", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("writeToFile", "pathInstruction"),
			usage: getPrompt("writeToFile", "pathUsage"),
		},
		{
			name: "content",
			required: true,
			instruction: getPrompt("writeToFile", "contentInstruction"),
			usage: getPrompt("writeToFile", "contentUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "write_to_file",
	description: getPrompt("writeToFile", "nativeDescription"),
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction: getPrompt("writeToFile", "nativePathInstruction"),
		},
		{
			name: "content",
			required: true,
			instruction: getPrompt("writeToFile", "nativeContentInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const write_to_file_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
