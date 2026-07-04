import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../../types"

const TRINITY_TOOL_USE_TEMPLATE = (_context: SystemPromptContext) => getPrompt("trinityOverrides", "toolUse")

const TRINITY_RULES_TEMPLATE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("trinityOverrides", "rules", {
		askPolicy: isYolo
			? "Use your available tools and apply your best judgment to accomplish the task without asking the user any followup questions, making reasonable assumptions from the provided context"
			: "You are only allowed to ask the user questions using the ask_followup_question tool. Use this tool only when you need additional details to complete a task, and be sure to use a clear and concise question that will help you move forward with the task. However if you can use the available tools to avoid having to ask the user questions, you should do so",
		outputRecovery: isYolo
			? ""
			: " If you absolutely need to see the actual terminal output, use the ask_followup_question tool to request the user to copy and paste it back to you.",
	})
}

export const trinityComponentOverrides: PromptVariant["componentOverrides"] = {
	[SystemPromptSection.TOOL_USE]: {
		template: TRINITY_TOOL_USE_TEMPLATE,
	},
	[SystemPromptSection.RULES]: {
		template: TRINITY_RULES_TEMPLATE,
	},
}
