import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.RENAME

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "rename",
	description: getPrompt("rename", "description"),
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: getPrompt("rename", "filePathInstruction"),
			usage: getPrompt("rename", "filePathUsage"),
		},
		{
			name: "line",
			required: true,
			type: "integer",
			instruction: getPrompt("rename", "lineInstruction"),
		},
		{
			name: "character",
			required: true,
			type: "integer",
			instruction: getPrompt("rename", "characterInstruction"),
		},
		{
			name: "new_name",
			required: true,
			instruction: getPrompt("rename", "newNameInstruction"),
			usage: getPrompt("rename", "newNameUsage"),
		},
		{
			name: "dry_run",
			required: false,
			type: "boolean",
			instruction: getPrompt("rename", "dryRunInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nativeNextGen: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	description: getPrompt("rename", "nativeDescription"),
}

export const rename_variants = [generic, nativeNextGen]
