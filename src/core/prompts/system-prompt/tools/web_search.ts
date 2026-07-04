import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.WEB_SEARCH,
	name: "web_search",
	description: getPrompt("webSearch", "description"),
	contextRequirements: (context) => context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: getPrompt("webSearch", "queryInstruction"),
			usage: getPrompt("webSearch", "queryUsage"),
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: getPrompt("webSearch", "allowedDomainsInstruction"),
			usage: getPrompt("webSearch", "allowedDomainsUsage"),
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: getPrompt("webSearch", "blockedDomainsInstruction"),
			usage: getPrompt("webSearch", "blockedDomainsUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.WEB_SEARCH,
	name: "web_search",
	description: getPrompt("webSearch", "nativeDescription"),
	contextRequirements: (context) => context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: getPrompt("webSearch", "queryInstruction"),
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: getPrompt("webSearch", "allowedDomainsInstruction"),
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: getPrompt("webSearch", "blockedDomainsInstruction"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_search_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
