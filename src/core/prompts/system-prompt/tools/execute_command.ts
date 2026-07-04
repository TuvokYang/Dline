import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.BASH,
	name: "execute_command",
	description: getPrompt("executeCommand", "description"),
	parameters: [
		{
			name: "command",
			required: true,
			instruction: getPrompt("executeCommand", "commandInstruction"),
			usage: getPrompt("executeCommand", "commandUsage"),
		},
		{
			name: "requires_approval",
			required: true,
			instruction: getPrompt("executeCommand", "requiresApprovalInstruction"),
			usage: getPrompt("executeCommand", "requiresApprovalUsage"),
			type: "boolean",
		},
		{
			name: "timeout",
			required: false,
			type: "integer",
			contextRequirements: (context) => context.yoloModeToggled === true,
			instruction: getPrompt("executeCommand", "timeoutInstruction"),
			usage: getPrompt("executeCommand", "timeoutUsage"),
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description: getPrompt("executeCommand", "nativeDescription"),
	parameters: [
		{
			name: "command",
			required: true,
			instruction: getPrompt("executeCommand", "nativeCommandInstruction"),
		},
		{
			name: "requires_approval",
			required: true,
			instruction: getPrompt("executeCommand", "nativeRequiresApprovalInstruction"),
			type: "boolean",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description: getPrompt("executeCommand", "gemini3Description"),
	parameters: [
		{
			name: "command",
			required: true,
			instruction: getPrompt("executeCommand", "gemini3CommandInstruction"),
		},
		{
			name: "requires_approval",
			required: true,
			instruction: getPrompt("executeCommand", "nativeRequiresApprovalInstruction"),
			type: "boolean",
		},
	],
}

export const execute_command_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
