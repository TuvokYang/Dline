import { ClineDefaultTool } from "@shared/tools"
import type { AgentBaseConfig } from "./AgentConfigLoader"

export const DEFAULT_SUBAGENT_NAME = "default"
export const DEFAULT_SUBAGENT_FILE_NAME = "default.yml"

export const DEFAULT_SUBAGENT_ALLOWED_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BASH,
	ClineDefaultTool.LOAD_SKILL,
	ClineDefaultTool.ATTEMPT,
]

export const DEFAULT_SUBAGENT_CONFIG: AgentBaseConfig = {
	name: DEFAULT_SUBAGENT_NAME,
	description: "Built-in readonly research subagent",
	tools: [...DEFAULT_SUBAGENT_ALLOWED_TOOLS],
	systemPrompt: "",
}

export const DEFAULT_SUBAGENT_YAML_CONTENT = `---
name: default
description: Built-in readonly research subagent
tools:
  - read_file
  - list_files
  - search_files
  - list_code_definition_names
  - execute_command
  - load_skill
  - attempt_completion
skills: []
# maxOutputTokens is measured in tokens. Omit it for the dynamic 5% default,
# use 0.05 for a ratio, or use a positive integer such as 10240 for an absolute budget.
---
You are the default readonly research subagent. Explore the codebase, read relevant files, trace call chains, and report concise, actionable findings.

Use execute_command only for readonly operations. Do not modify files or system state.
`

/** Check whether a requested subagent name selects the built-in profile. */
export function isDefaultSubagentName(name: string | undefined): boolean {
	return name?.trim().toLowerCase() === DEFAULT_SUBAGENT_NAME
}
