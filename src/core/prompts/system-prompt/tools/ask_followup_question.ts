import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.ASK,
	name: "ask_followup_question",
	description: getPrompt("askFollowupQuestion", "description"),
	contextRequirements: (context) => !context.yoloModeToggled,
	parameters: [
		{
			name: "question",
			required: true,
			instruction: getPrompt("askFollowupQuestion", "questionInstruction"),
			usage: getPrompt("askFollowupQuestion", "questionUsage"),
		},
		{
			name: "options",
			required: false,
			instruction: getPrompt("askFollowupQuestion", "optionsInstruction"),
			usage: getPrompt("askFollowupQuestion", "optionsUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.ASK,
	name: "ask_followup_question",
	description: getPrompt("askFollowupQuestion", "nativeDescription"),
	contextRequirements: (context) => !context.yoloModeToggled,
	parameters: [
		{
			name: "question",
			required: true,
			instruction: getPrompt("askFollowupQuestion", "nativeQuestionInstruction"),
		},
		{
			name: "options",
			required: true,
			instruction: getPrompt("askFollowupQuestion", "nativeOptionsInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const ask_followup_question_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
