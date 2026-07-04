import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.WEB_FETCH,
	name: "web_fetch",
	description: getPrompt("webFetch", "description"),
	contextRequirements: (context) => context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "url",
			required: true,
			instruction: getPrompt("webFetch", "urlInstruction"),
			usage: getPrompt("webFetch", "urlUsage"),
		},
		{
			name: "prompt",
			required: true,
			instruction: getPrompt("webFetch", "promptInstruction"),
			usage: getPrompt("webFetch", "promptUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.WEB_FETCH,
	name: "web_fetch",
	description: getPrompt("webFetch", "nativeDescription"),
	contextRequirements: (context) => context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "url",
			required: true,
			instruction: getPrompt("webFetch", "urlInstruction"),
		},
		{
			name: "prompt",
			required: true,
			instruction: getPrompt("webFetch", "nativePromptInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_fetch_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
