import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.ATTEMPT

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "attempt_completion",
	description: getPrompt("attemptCompletion", "description"),
	parameters: [
		{
			name: "result",
			required: true,
			instruction: getPrompt("attemptCompletion", "resultInstruction"),
			usage: getPrompt("attemptCompletion", "resultUsage"),
		},
		{
			name: "command",
			required: false,
			instruction: getPrompt("attemptCompletion", "commandInstruction"),
			usage: getPrompt("attemptCompletion", "commandUsage"),
		},
	],
}

const GPT_5: ClineToolSpec = {
	variant: ModelFamily.GPT_5,
	id,
	name: "attempt_completion",
	description: getPrompt("attemptCompletion", "gpt5Description"),
	parameters: [
		{
			name: "result",
			required: true,
			instruction: getPrompt("attemptCompletion", "resultInstruction"),
			usage: getPrompt("attemptCompletion", "resultUsage"),
		},
		{
			name: "command",
			required: false,
			instruction: getPrompt("attemptCompletion", "commandInstruction"),
			usage: getPrompt("attemptCompletion", "commandUsage"),
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "attempt_completion",
	description: getPrompt("attemptCompletion", "nativeDescription"),
	parameters: [
		{
			name: "result",
			required: true,
			instruction: getPrompt("attemptCompletion", "nativeResultInstruction"),
		},
		{
			name: "command",
			required: false,
			instruction: getPrompt("attemptCompletion", "nativeCommandInstruction"),
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const attempt_completion_variants = [generic, GPT_5, NATIVE_NEXT_GEN, NATIVE_GPT_5]
