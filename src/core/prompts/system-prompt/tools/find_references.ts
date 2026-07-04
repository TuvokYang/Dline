import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FIND_REFERENCES

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "find_references",
	description: getPrompt("findReferences", "description"),
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: getPrompt("findReferences", "filePathInstruction"),
			usage: getPrompt("findReferences", "filePathUsage"),
		},
		{
			name: "line",
			required: true,
			type: "integer",
			instruction: getPrompt("findReferences", "lineInstruction"),
		},
		{
			name: "character",
			required: true,
			type: "integer",
			instruction: getPrompt("findReferences", "characterInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nativeNextGen: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	description: getPrompt("findReferences", "nativeDescription"),
}

export const find_references_variants = [generic, nativeNextGen]
