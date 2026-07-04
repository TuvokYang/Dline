import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.REPLACE_TEXT

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "replace_text",
	description: getPrompt("replaceText", "description"),
	parameters: [
		{
			name: "find",
			required: true,
			instruction: getPrompt("replaceText", "findInstruction"),
			usage: getPrompt("replaceText", "findUsage"),
		},
		{
			name: "replace",
			required: true,
			instruction: getPrompt("replaceText", "replaceInstruction"),
			usage: getPrompt("replaceText", "replaceUsage"),
		},
		{
			name: "file_pattern",
			required: true,
			instruction: getPrompt("replaceText", "filePatternInstruction"),
			usage: getPrompt("replaceText", "filePatternUsage"),
		},
		{
			name: "dry_run",
			required: false,
			type: "boolean",
			instruction: getPrompt("replaceText", "dryRunInstruction"),
		},
		{
			name: "literal",
			required: false,
			type: "boolean",
			instruction: getPrompt("replaceText", "literalInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nativeNextGen: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	description: getPrompt("replaceText", "nativeDescription"),
}

export const replace_text_variants = [generic, nativeNextGen]
