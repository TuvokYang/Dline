import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.GENERATE_REPORT

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "generate_report",
	description: getPrompt("generateReport", "description"),
	parameters: [
		{
			name: "title",
			required: true,
			instruction: getPrompt("generateReport", "titleInstruction"),
			usage: getPrompt("generateReport", "titleUsage"),
		},
		{
			name: "content",
			required: true,
			instruction: getPrompt("generateReport", "contentInstruction"),
			usage: getPrompt("generateReport", "contentUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	description: getPrompt("generateReport", "nativeDescription"),
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const generate_report_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
