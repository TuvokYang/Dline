import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import type { SystemPromptContext } from "../../types"

const HERMES_AGENT_ROLE_TEMPLATE = getPrompt("hermesOverrides", "agentRole")
const HERMES_OBJECTIVE_TEMPLATE = getPrompt("hermesOverrides", "objective")
const HERMES_TASK_PROGRESS_TEMPLATE = getPrompt("hermesOverrides", "taskProgress")
const HERMES_MCP_TEMPLATE = getPrompt("hermesOverrides", "mcp")

const HERMES_TOOL_USE_TEMPLATE = (context: SystemPromptContext) => {
	const subagents = context.subagentsEnabled === true && !context.isSubagentRun ? getPrompt("hermesOverrides", "subagents") : ""
	return getPrompt("hermesOverrides", "toolUse", { subagentsSection: subagents })
}

const HERMES_RULES_TEMPLATE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("hermesOverrides", "rules", {
		askPolicy: isYolo
			? "Use tools and best judgment to complete the task without follow-up questions, making reasonable assumptions from context."
			: "Ask questions only via ask_followup_question when details are required to proceed; otherwise prefer using tools. Example: if a file may be on the Desktop, use list_files to find it rather than asking the user.",
		vaguePolicy: isYolo
			? ""
			: "\n- If the request is vague, use ask_followup_question to clarify. If intent can be inferred from context/tools, proceed without unnecessary questions.",
		outputRecovery: isYolo ? "" : " If you must see output, use ask_followup_question to request a pasted log.",
	})
}

export const hermesComponentOverrides = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: HERMES_AGENT_ROLE_TEMPLATE,
	},
	[SystemPromptSection.OBJECTIVE]: {
		template: HERMES_OBJECTIVE_TEMPLATE,
	},
	[SystemPromptSection.TOOL_USE]: {
		template: HERMES_TOOL_USE_TEMPLATE,
	},
	[SystemPromptSection.RULES]: {
		template: HERMES_RULES_TEMPLATE,
	},
	[SystemPromptSection.TASK_PROGRESS]: {
		template: HERMES_TASK_PROGRESS_TEMPLATE,
	},
	[SystemPromptSection.MCP]: {
		template: HERMES_MCP_TEMPLATE,
	},
}
