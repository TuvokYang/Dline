import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { isGPT5ModelFamily, isGptOssModelFamily } from "@/utils/model-utils"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.APPLY_PATCH,
	name: "apply_patch",
	description: getPrompt("applyPatch", "description"),
	contextRequirements: (context) =>
		isGPT5ModelFamily(context.providerInfo.model.id) || isGptOssModelFamily(context.providerInfo.model.id),
	parameters: [
		{
			name: "input",
			required: true,
			instruction: getPrompt("applyPatch", "inputInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const GPT_5: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.GPT_5,
}
export const apply_patch_variants = [NATIVE_GPT_5, GPT_5]
