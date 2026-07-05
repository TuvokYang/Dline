import { ClineDefaultTool } from "@/shared/tools"

/**
 * Layer 1: BASIC — Self-sufficient for reading, searching, exploring, and conversation closure.
 * A variant with only these tools can scan code, search, list files, and report results.
 */
export const BASIC_TOOLS = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.ASK,
	ClineDefaultTool.ATTEMPT,
	ClineDefaultTool.PLAN_MODE,
	ClineDefaultTool.QNA_RESPOND,
	ClineDefaultTool.ACT_MODE,
] as const

/**
 * Layer 2: ADVANCED — Command execution, networking, MCP, skills, code refactoring, bulk editing.
 */
export const ADVANCED_TOOLS = [
	ClineDefaultTool.BASH,
	ClineDefaultTool.BROWSER,
	ClineDefaultTool.WEB_FETCH,
	ClineDefaultTool.WEB_SEARCH,
	ClineDefaultTool.MCP_USE,
	ClineDefaultTool.MCP_ACCESS,
	ClineDefaultTool.MCP_DOCS,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.FIND_REFERENCES,
	ClineDefaultTool.RENAME,
	ClineDefaultTool.REPLACE_TEXT,
	ClineDefaultTool.APPLY_PATCH,
] as const

/**
 * Layer 3: ORCHESTRATION — Multi-agent coordination, progress tracking, output generation.
 */
export const ORCHESTRATION_TOOLS = [
	ClineDefaultTool.SPAWN_TASK,
	ClineDefaultTool.FOCUS_CHAIN_CHANGE,
	ClineDefaultTool.USE_SUBAGENTS,
	ClineDefaultTool.STATUS_UPDATE,
	ClineDefaultTool.GENERATE_EXPLANATION,
	ClineDefaultTool.GENERATE_REPORT,
] as const

/**
 * Standard file creation and editing pair.
 */
export const STANDARD_EDIT = [ClineDefaultTool.FILE_NEW, ClineDefaultTool.FILE_EDIT] as const
