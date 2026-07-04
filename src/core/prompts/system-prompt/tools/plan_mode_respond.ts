import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.PLAN_MODE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "plan_mode_respond",
	description: getPrompt("planModeRespond", "description"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("planModeRespond", "responseInstruction"),
			usage: getPrompt("planModeRespond", "responseUsage"),
		},
		{
			name: "needs_more_exploration",
			required: false,
			instruction: getPrompt("planModeRespond", "needsMoreExplorationInstruction"),
			usage: getPrompt("planModeRespond", "needsMoreExplorationUsage"),
			type: "boolean",
		},
		{
			name: "task_progress",
			required: false,
			instruction: getPrompt("taskProgress", "paramInstruction"),
			usage: getPrompt("planModeRespond", "taskProgressUsage"),
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "plan_mode_respond",
	description: getPrompt("planModeRespond", "description"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("planModeRespond", "nativeResponseInstruction"),
		},
		{
			name: "task_progress",
			required: false,
			instruction: getPrompt("taskProgress", "paramInstruction"),
		},
	],
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id,
	name: "plan_mode_respond",
	description: getPrompt("planModeRespond", "gemini3Description"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("planModeRespond", "gemini3ResponseInstruction"),
			usage: getPrompt("planModeRespond", "responseUsage"),
		},
		{
			name: "needs_more_exploration",
			required: false,
			instruction: getPrompt("planModeRespond", "gemini3NeedsMoreExplorationInstruction"),
			usage: getPrompt("planModeRespond", "needsMoreExplorationUsage"),
			type: "boolean",
		},
		{
			name: "task_progress",
			required: false,
			instruction: getPrompt("taskProgress", "paramInstruction"),
			usage: getPrompt("planModeRespond", "taskProgressUsage"),
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const plan_mode_respond_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
