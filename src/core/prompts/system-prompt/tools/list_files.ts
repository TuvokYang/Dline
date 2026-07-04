import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.LIST_FILES

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "list_files",
	description: getPrompt("listFiles", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("listFiles", "pathInstruction"),
			usage: getPrompt("listFiles", "pathUsage"),
		},
		{
			name: "recursive",
			required: false,
			instruction: getPrompt("listFiles", "recursiveInstruction"),
			usage: getPrompt("listFiles", "recursiveUsage"),
			type: "boolean",
		},
		{
			name: "show_metadata",
			required: false,
			instruction: getPrompt("listFiles", "showMetadataInstruction"),
			usage: getPrompt("listFiles", "showMetadataUsage"),
			type: "boolean",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "list_files",
	description: getPrompt("listFiles", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("listFiles", "nativePathInstruction"),
		},
		{
			name: "recursive",
			required: false,
			instruction: getPrompt("listFiles", "recursiveInstruction"),
			type: "boolean",
		},
		{
			name: "show_metadata",
			required: false,
			instruction: getPrompt("listFiles", "showMetadataInstruction"),
			type: "boolean",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const list_files_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
