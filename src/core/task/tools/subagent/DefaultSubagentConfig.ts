import { ClineDefaultTool } from "@shared/tools"
import type { AgentBaseConfig } from "./AgentConfigLoader"

export const DEFAULT_SUBAGENT_NAME = "default"

export const DEFAULT_SUBAGENT_ALLOWED_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BASH,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.ATTEMPT,
]

export const DEFAULT_SUBAGENT_CONFIG: AgentBaseConfig = {
	name: DEFAULT_SUBAGENT_NAME,
	description: "Built-in readonly research subagent",
	tools: [...DEFAULT_SUBAGENT_ALLOWED_TOOLS],
	systemPrompt: "",
}

/** Check whether a requested subagent name selects the built-in profile. */
export function isDefaultSubagentName(name: string | undefined): boolean {
	return name?.trim().toLowerCase() === DEFAULT_SUBAGENT_NAME
}
