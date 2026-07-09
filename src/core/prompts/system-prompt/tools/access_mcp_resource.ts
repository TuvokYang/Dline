import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import { hasEnabledMcpServers } from "../components/mcp"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.MCP_ACCESS,
	name: "access_mcp_resource",
	description: getPrompt("accessMcpResource", "description"),
	contextRequirements: hasEnabledMcpServers,
	parameters: [
		{
			name: "server_name",
			required: true,
			instruction: getPrompt("accessMcpResource", "serverNameInstruction"),
			usage: getPrompt("accessMcpResource", "serverNameUsage"),
		},
		{
			name: "uri",
			required: true,
			instruction: getPrompt("accessMcpResource", "uriInstruction"),
			usage: getPrompt("accessMcpResource", "uriUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.MCP_ACCESS,
	name: "access_mcp_resource",
	description: getPrompt("accessMcpResource", "nativeDescription"),
	contextRequirements: hasEnabledMcpServers,
	parameters: [
		{
			name: "server_name",
			required: true,
			instruction: getPrompt("accessMcpResource", "serverNameInstruction"),
			usage: getPrompt("accessMcpResource", "serverNameUsage"),
		},
		{
			name: "uri",
			required: true,
			instruction: getPrompt("accessMcpResource", "uriInstruction"),
			usage: getPrompt("accessMcpResource", "uriUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const access_mcp_resource_variants = [generic, nextGen, gpt, NATIVE_GPT_5, NATIVE_NEXT_GEN]
