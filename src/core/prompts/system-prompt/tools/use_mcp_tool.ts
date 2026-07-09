import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import { hasEnabledMcpServers } from "../components/mcp"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.MCP_USE,
	name: "use_mcp_tool",
	description: getPrompt("useMcpTool", "description"),
	contextRequirements: hasEnabledMcpServers,
	parameters: [
		{
			name: "server_name",
			required: true,
			instruction: getPrompt("useMcpTool", "serverNameInstruction"),
			usage: getPrompt("useMcpTool", "serverNameUsage"),
		},
		{
			name: "tool_name",
			required: true,
			instruction: getPrompt("useMcpTool", "toolNameInstruction"),
			usage: getPrompt("useMcpTool", "toolNameUsage"),
		},
		{
			name: "arguments",
			required: true,
			instruction: getPrompt("useMcpTool", "argumentsInstruction"),
			usage: getPrompt("useMcpTool", "argumentsUsage"),
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const use_mcp_tool_variants = [generic]
