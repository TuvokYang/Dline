import { ClineDefaultTool } from "../../../shared/tools"

export const NATIVE_TOOL_IDS = [
	ClineDefaultTool.FILE_NEW,
	ClineDefaultTool.FILE_EDIT,
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.ASK,
	ClineDefaultTool.ATTEMPT,
	ClineDefaultTool.MAKE_PLAN,
	ClineDefaultTool.QNA_RESPOND,
	ClineDefaultTool.ACT_MODE,
	ClineDefaultTool.BASH,
	ClineDefaultTool.BROWSER,
	ClineDefaultTool.WEB_FETCH,
	ClineDefaultTool.WEB_SEARCH,
	ClineDefaultTool.MCP_USE,
	ClineDefaultTool.MCP_ACCESS,
	ClineDefaultTool.MCP_DOCS,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.LOAD_MCP,
	ClineDefaultTool.LOAD_SKILL,
	ClineDefaultTool.LOAD_WORKFLOW,
	ClineDefaultTool.FIND_REFERENCES,
	ClineDefaultTool.RENAME,
	ClineDefaultTool.REPLACE_TEXT,
	ClineDefaultTool.APPLY_PATCH,
	ClineDefaultTool.SPAWN_TASK,
	ClineDefaultTool.FOCUS_CHAIN_CHANGE,
	ClineDefaultTool.USE_SUBAGENT,
	ClineDefaultTool.USE_SUBAGENTS,
	ClineDefaultTool.STATUS_UPDATE,
	ClineDefaultTool.GENERATE_REPORT,
] as const

export const LITE_TOOL_IDS = [
	ClineDefaultTool.FILE_NEW,
	ClineDefaultTool.FILE_EDIT,
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.ASK,
	ClineDefaultTool.ATTEMPT,
	ClineDefaultTool.MAKE_PLAN,
	ClineDefaultTool.QNA_RESPOND,
	ClineDefaultTool.ACT_MODE,
	ClineDefaultTool.BASH,
	ClineDefaultTool.FIND_REFERENCES,
	ClineDefaultTool.RENAME,
	ClineDefaultTool.REPLACE_TEXT,
	ClineDefaultTool.USE_SUBAGENT,
	ClineDefaultTool.USE_SUBAGENTS,
	ClineDefaultTool.SPAWN_TASK,
	ClineDefaultTool.STATUS_UPDATE,
	ClineDefaultTool.GENERATE_REPORT,
] as const

/** Tools exposed only while an internal runtime operation is active. */
export const INTERNAL_RUNTIME_TOOL_IDS = [ClineDefaultTool.SUMMARIZE_TASK] as const

export const REQUEST_SCOPED_TOOL_IDS = INTERNAL_RUNTIME_TOOL_IDS

export type RequestScopedToolId = (typeof REQUEST_SCOPED_TOOL_IDS)[number]

const REQUEST_SCOPED_TOOL_ID_SET: ReadonlySet<string> = new Set(REQUEST_SCOPED_TOOL_IDS)

/** Reports whether a tool schema may be projected only for one selected request. */
export function isRequestScopedToolId(id: string): id is RequestScopedToolId {
	return REQUEST_SCOPED_TOOL_ID_SET.has(id)
}
