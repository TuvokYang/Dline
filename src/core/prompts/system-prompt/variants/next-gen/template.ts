import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import type { SystemPromptContext } from "../../types"

export const baseTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

{{${SystemPromptSection.TOOL_USE}}}

====

{{${SystemPromptSection.TASK_PROGRESS}}}

====

{{${SystemPromptSection.MCP}}}

====

{{${SystemPromptSection.EDITING_FILES}}}

====

{{${SystemPromptSection.ACT_VS_PLAN}}}

====

{{${SystemPromptSection.CAPABILITIES}}}

====

{{${SystemPromptSection.SKILLS}}}

====

{{${SystemPromptSection.FEEDBACK}}}

====

{{${SystemPromptSection.RULES}}}

====

{{${SystemPromptSection.SYSTEM_INFO}}}

====

{{${SystemPromptSection.OBJECTIVE}}}

====

{{${SystemPromptSection.USER_INSTRUCTIONS}}}`

export const rules_template = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("nextGenTemplate", "rulesTemplate", {
		askPolicy: isYolo
			? "Use your available tools and apply your best judgment to accomplish the task without asking the user any followup questions, making reasonable assumptions from the provided context"
			: "You are only allowed to ask the user questions using the ask_followup_question tool. Use this tool only when you need additional details to complete a task, and be sure to use a clear and concise question that will help you move forward with the task. However if you can use the available tools to avoid having to ask the user questions, you should do so",
		vaguePolicy: isYolo
			? ""
			: "\n- When the user is being vague, you should be proactive about asking clarifying questions using the ask_followup_question tool to ensure you understand their request. However, if you can infer the user's intent based on the context and available tools, you should proceed without asking unnecessary questions",
		outputRecovery: isYolo
			? ""
			: " If output is still unavailable after reasonable checks and you need it to continue, use the ask_followup_question tool to request the user to copy and paste it back to you.",
	})
}
