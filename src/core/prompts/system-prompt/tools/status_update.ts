import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.STATUS_UPDATE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "status_update",
	description: getPrompt("statusUpdate", "description"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("statusUpdate", "responseInstruction"),
			usage: getPrompt("statusUpdate", "responseUsage"),
		},
		{
			name: "requires_acknowledgment",
			required: false,
			type: "boolean",
			instruction: getPrompt("statusUpdate", "requiresAcknowledgmentInstruction"),
			usage: getPrompt("statusUpdate", "requiresAcknowledgmentUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
	description: getPrompt("statusUpdate", "nativeDescription"),
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const status_update_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
