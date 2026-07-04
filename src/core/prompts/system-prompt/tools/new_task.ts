import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.NEW_TASK

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "new_task",
	description: getPrompt("newTask", "description"),
	contextRequirements: (context) => !context.yoloModeToggled,
	parameters: [
		{
			name: "context",
			required: true,
			instruction: getPrompt("newTask", "contextInstruction"),
			usage: getPrompt("newTask", "contextUsage"),
		},
	],
}

export const new_task_variants = [generic]
