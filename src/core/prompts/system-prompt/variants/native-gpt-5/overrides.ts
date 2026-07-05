import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../../types"

const GPT5_AGENT_ROLE = (_context: SystemPromptContext) => getPrompt("nativeGpt51Overrides", "agentRole")

const GPT5_RULES = (_context: SystemPromptContext) => getPrompt("nativeGpt51Overrides", "rules")

const GPT5_TOOL_USE = (_context: SystemPromptContext) => getPrompt("nativeGpt51Overrides", "toolUse")

const GPT5_ACT_VS_PLAN = (context: SystemPromptContext) =>
	getPrompt("nativeGpt51Overrides", "actVsPlan", {
		clarifyPermission:
			context.yoloModeToggled !== true
				? " You may also ask the user clarifying questions with ask_followup_question to get a better understanding of the task."
				: "",
	})

const GPT5_OBJECTIVE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("nativeGpt51Overrides", "objective", {
		clarifyRule: isYolo
			? "state your assumptions clearly before proceeding"
			: "**ask clarifying questions** using ask_followup_question rather than making assumptions",
		missingParamPolicy: isYolo
			? ""
			: " and instead, ask the user to provide the missing parameters using the ask_followup_question tool",
	})
}

const GPT5_FEEDBACK = (_context: SystemPromptContext) => getPrompt("nativeGpt51Overrides", "feedback")

export const gpt5ComponentOverrides: PromptVariant["componentOverrides"] = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: GPT5_AGENT_ROLE,
	},
	[SystemPromptSection.RULES]: {
		template: GPT5_RULES,
	},
	[SystemPromptSection.TOOL_USE]: {
		template: GPT5_TOOL_USE,
	},
	[SystemPromptSection.ACT_VS_PLAN]: {
		template: GPT5_ACT_VS_PLAN,
	},
	[SystemPromptSection.OBJECTIVE]: {
		template: GPT5_OBJECTIVE,
	},
	[SystemPromptSection.FEEDBACK]: {
		template: GPT5_FEEDBACK,
	},
}
