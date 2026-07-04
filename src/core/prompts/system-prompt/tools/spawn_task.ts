import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.SPAWN_TASK

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "spawn_task",
	description: getPrompt("spawnTask", "description"),
	parameters: [
		{
			name: "task",
			required: true,
			instruction: getPrompt("spawnTask", "taskInstruction"),
			usage: getPrompt("spawnTask", "taskUsage"),
		},
		{
			name: "context",
			required: false,
			instruction: getPrompt("spawnTask", "contextInstruction"),
			usage: getPrompt("spawnTask", "contextUsage"),
		},
	],
}

export const spawn_task_variants = [generic]
