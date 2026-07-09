import { AvailableToolsResponse, ToolGroup, ToolInfo } from "@shared/proto/dline/file"
import { ClineDefaultTool } from "@shared/tools"
import type { Controller } from ".."

/**
 * Tool descriptions for subagent configuration UI.
 * Only includes tools that are safe and relevant for subagents.
 */
const TOOL_DESCRIPTIONS: Record<string, { description: string; isReadOnly: boolean }> = {
	[ClineDefaultTool.FILE_READ]: { description: "Read file contents", isReadOnly: true },
	[ClineDefaultTool.SEARCH]: { description: "Search files using regex", isReadOnly: true },
	[ClineDefaultTool.LIST_FILES]: { description: "List directory contents", isReadOnly: true },
	[ClineDefaultTool.LIST_CODE_DEF]: { description: "List code definitions", isReadOnly: true },
	[ClineDefaultTool.BROWSER]: { description: "Browser automation", isReadOnly: true },
	[ClineDefaultTool.ASK]: { description: "Ask user a follow-up question", isReadOnly: true },
	[ClineDefaultTool.WEB_FETCH]: { description: "Fetch web content", isReadOnly: true },
	[ClineDefaultTool.WEB_SEARCH]: { description: "Search the web", isReadOnly: true },
	[ClineDefaultTool.USE_SKILL]: { description: "Load and activate a skill", isReadOnly: true },
	[ClineDefaultTool.MCP_USE]: { description: "Use an MCP tool", isReadOnly: true },
	[ClineDefaultTool.MCP_ACCESS]: { description: "Access an MCP resource", isReadOnly: true },
	[ClineDefaultTool.MCP_DOCS]: { description: "Load MCP documentation", isReadOnly: true },
	[ClineDefaultTool.PLAN_MODE]: { description: "Respond in plan mode", isReadOnly: true },
	[ClineDefaultTool.GENERATE_EXPLANATION]: { description: "Generate diff explanation", isReadOnly: true },
	[ClineDefaultTool.FIND_REFERENCES]: { description: "Find symbol references", isReadOnly: true },
	[ClineDefaultTool.FILE_NEW]: { description: "Write a new file", isReadOnly: false },
	[ClineDefaultTool.FILE_EDIT]: { description: "Edit an existing file", isReadOnly: false },
	[ClineDefaultTool.BASH]: { description: "Execute CLI commands", isReadOnly: false },
	[ClineDefaultTool.ATTEMPT]: { description: "Complete the task", isReadOnly: false },
	[ClineDefaultTool.APPLY_PATCH]: { description: "Apply a unified diff patch", isReadOnly: false },
	[ClineDefaultTool.SPAWN_TASK]: { description: "Spawn a new task", isReadOnly: false },
	[ClineDefaultTool.FOCUS_CHAIN_CHANGE]: { description: "Change the focus chain", isReadOnly: false },
	[ClineDefaultTool.RENAME]: { description: "Rename a symbol", isReadOnly: false },
	[ClineDefaultTool.REPLACE_TEXT]: { description: "Replace text across files", isReadOnly: false },
}

/** Tools excluded from subagent configuration (internal/system tools). */
const EXCLUDED_TOOLS = new Set([
	ClineDefaultTool.TODO,
	ClineDefaultTool.CONDENSE,
	ClineDefaultTool.SUMMARIZE_TASK,
	ClineDefaultTool.REPORT_BUG,
	ClineDefaultTool.NEW_RULE,
	ClineDefaultTool.NEW_TASK,
	ClineDefaultTool.ACT_MODE,
	ClineDefaultTool.QNA_RESPOND,
	ClineDefaultTool.GENERATE_REPORT,
	ClineDefaultTool.STATUS_UPDATE,
])

/**
 * Returns available tools grouped by category for subagent configuration UI.
 * Tools are dynamically generated from ClineDefaultTool enum to stay in sync.
 */
export async function getAvailableTools(_controller: Controller): Promise<AvailableToolsResponse> {
	const readOnlyGroup: ToolInfo[] = []
	const writeGroup: ToolInfo[] = []

	for (const toolName of Object.values(ClineDefaultTool)) {
		if (EXCLUDED_TOOLS.has(toolName)) continue

		const info = TOOL_DESCRIPTIONS[toolName]
		if (!info) continue

		const toolInfo = ToolInfo.create({
			name: toolName,
			description: info.description,
			isReadOnly: info.isReadOnly,
		})

		if (info.isReadOnly) {
			readOnlyGroup.push(toolInfo)
		} else {
			writeGroup.push(toolInfo)
		}
	}

	return AvailableToolsResponse.create({
		groups: [
			ToolGroup.create({
				name: "Read-only",
				description: "Safe tools that do not modify files or execute commands",
				tools: readOnlyGroup,
			}),
			ToolGroup.create({
				name: "Write",
				description: "⚠️ Tools that can modify files or execute commands — use with caution",
				tools: writeGroup,
			}),
		],
	})
}
