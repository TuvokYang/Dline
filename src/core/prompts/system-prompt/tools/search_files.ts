import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.SEARCH

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "search_files",
	description: getPrompt("searchFiles", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("searchFiles", "pathInstruction"),
			usage: getPrompt("searchFiles", "pathUsage"),
		},
		{
			name: "regex",
			required: true,
			instruction: getPrompt("searchFiles", "regexInstruction"),
			usage: getPrompt("searchFiles", "regexUsage"),
		},
		{
			name: "file_pattern",
			required: false,
			instruction: getPrompt("searchFiles", "filePatternInstruction"),
			usage: getPrompt("searchFiles", "filePatternUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "search_files",
	description: getPrompt("searchFiles", "description"),
	parameters: [
		{
			name: "path",
			required: true,
			instruction: getPrompt("searchFiles", "pathInstruction"),
			usage: getPrompt("searchFiles", "pathUsage"),
		},
		{
			name: "regex",
			required: true,
			instruction: getPrompt("searchFiles", "regexInstruction"),
			usage: getPrompt("searchFiles", "regexUsage"),
		},
		{
			name: "file_pattern",
			required: false,
			instruction: getPrompt("searchFiles", "filePatternInstruction"),
			usage: getPrompt("searchFiles", "filePatternUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const search_files_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
