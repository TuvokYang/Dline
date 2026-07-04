import { getPrompt } from "../../../i18n"
import { hasEnabledMcpServers } from "../../components/mcp"
import { SystemPromptSection } from "../../templates/placeholders"
import type { SystemPromptContext } from "../../types"

const GLM_OBJECTIVE_TEMPLATE = getPrompt("glmOverrides", "objective")
const GLM_TASK_PROGRESS_TEMPLATE = getPrompt("glmOverrides", "taskProgress")
const GLM_MCP_TEMPLATE = getPrompt("glmOverrides", "mcp")

const GLM_TOOL_USE_TEMPLATE = (context: SystemPromptContext) => {
	// When native tool calling is enabled, tools are passed via API parameters,
	// so only emit a brief guidance — no XML tool definitions in the prompt.
	// When native tool calling is enabled, tools are passed via API parameters.
	// Use the system default tool use template — no GLM-specific XML tool definitions.
	if (context.enableNativeToolCalls) {
		return `TOOL USE

You have access to a set of tools that are executed upon the user's approval. You may use multiple tools in a single response when the operations are independent (e.g., reading several files, searching in parallel). For dependent operations where one result informs the next, use tools sequentially. You will receive the results of all tool uses in the user's response.

NEVER use command-line tools (sed, awk, ripgrep) or scripting languages to read or edit files. The existing file editing tools are sufficient for all file operations.

EVERY response must include at least one tool call. When actively working, use work tools step by step.`
	}
	const mcpSection = hasEnabledMcpServers(context) ? getPrompt("glmOverrides", "mcpTools") : ""
	const subagentsSection =
		context.subagentsEnabled === true && !context.isSubagentRun ? getPrompt("glmOverrides", "subagents") : ""
	return getPrompt("glmOverrides", "toolUseBase", { mcpSection, subagentsSection })
}

const GLM_RULES_TEMPLATE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("glmOverrides", "rules", {
		askPolicy: isYolo
			? "Use tools and best judgment to complete the task without follow-up questions, making reasonable assumptions from context."
			: "Ask questions only via ask_followup_question when details are required to proceed; otherwise prefer using tools. Example: if a file may be on the Desktop, use list_files to find it rather than asking the user.",
		vaguePolicy: isYolo
			? ""
			: "\n- If the request is vague, use ask_followup_question to clarify. If intent can be inferred from context/tools, proceed without unnecessary questions.",
		outputRecovery: isYolo ? "" : " If you must see output, use ask_followup_question to request a pasted log.",
	})
}

export const glmComponentOverrides = {
	[SystemPromptSection.OBJECTIVE]: {
		template: GLM_OBJECTIVE_TEMPLATE,
	},
	[SystemPromptSection.TOOL_USE]: {
		template: GLM_TOOL_USE_TEMPLATE,
	},
	[SystemPromptSection.RULES]: {
		template: GLM_RULES_TEMPLATE,
	},
	[SystemPromptSection.TASK_PROGRESS]: {
		template: GLM_TASK_PROGRESS_TEMPLATE,
	},
	[SystemPromptSection.MCP]: {
		template: GLM_MCP_TEMPLATE,
	},
}
