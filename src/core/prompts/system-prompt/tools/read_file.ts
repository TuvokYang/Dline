import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_READ

const READ_FILE_PARAMETERS: ClineToolSpec["parameters"] = [
	{
		name: "path",
		required: true,
		instruction: getPrompt("readFile", "pathInstruction"),
		usage: getPrompt("readFile", "pathUsage"),
	},
	{
		name: "start_line",
		required: false,
		type: "integer",
		instruction: getPrompt("readFile", "startLineInstruction"),
		usage: getPrompt("readFile", "startLineUsage"),
	},
	{
		name: "end_line",
		required: false,
		type: "integer",
		instruction: getPrompt("readFile", "endLineInstruction"),
		usage: getPrompt("readFile", "endLineUsage"),
	},
	TASK_PROGRESS_PARAMETER,
]

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description: getPrompt("readFile", "description"),
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_file",
	description: getPrompt("readFile", "description"),
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
