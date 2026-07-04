import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../../types"

const GEMINI_3_AGENT_ROLE_TEMPLATE = (_context: SystemPromptContext) => getPrompt("gemini3Overrides", "agentRole")
const GEMINI_3_EDITING_FILES_TEMPLATE = (_context: SystemPromptContext) => getPrompt("gemini3Overrides", "editingFiles")
const GEMINI_3_FEEDBACK_TEMPLATE = (_context: SystemPromptContext) => getPrompt("gemini3Overrides", "feedback")
const GEMINI_3_UPDATING_TASK_PROGRESS_TEMPLATE = (_context: SystemPromptContext) => getPrompt("gemini3Overrides", "taskProgress")

const GEMINI_3_TOOL_USE_TEMPLATE = (context: SystemPromptContext) =>
	getPrompt("gemini3Overrides", "toolUse", {
		parallelInstruction: context.enableParallelToolCalling
			? " You may use multiple tools in a single response when the operations are independent (e.g., reading several files, searching in parallel). For dependent operations where one result informs the next, use tools sequentially."
			: " You should use a single tool at a time and wait for the result before proceeding.",
	})

const GEMINI_3_OBJECTIVE_TEMPLATE = (context: SystemPromptContext) => {
	const isParallel = context.enableParallelToolCalling
	const isYolo = context.yoloModeToggled === true
	return getPrompt("gemini3Overrides", "objective", {
		parallelInstruction: isParallel
			? "You may call multiple independent tools in a single response to work efficiently."
			: "Use a single tool at a time and wait for the result before proceeding.",
		missingParamPolicy: isYolo
			? ""
			: " If one of the values for a required parameter is missing, ask the user to provide the missing parameters using the ask_followup_question tool (use your tools to gather information when possible to avoid unnecessary questions).",
	})
}

const GEMINI_3_RULES_TEMPLATE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	const isParallel = context.enableParallelToolCalling
	return getPrompt("gemini3Overrides", "rules", {
		outputRecovery: isYolo
			? ""
			: " If output is still unavailable after reasonable checks and you need it to continue, use the ask_followup_question tool to request the user to copy and paste it back to you.",
		parallelRule: isParallel
			? "\n- When multiple operations are independent (for example reading several files or searching in multiple directories), call multiple tools in a single response rather than one at a time. Use sequential tool calls only when later steps depend on earlier results."
			: "",
	})
}

const GEMINI_3_ACT_VS_PLAN_TEMPLATE = (context: SystemPromptContext) => {
	const isYolo = context.yoloModeToggled === true
	return getPrompt("gemini3Overrides", "actVsPlan", {
		clarifyPermission: isYolo
			? ""
			: "\n- Ask targeted clarifying questions only when they will directly influence your implementation approach",
		actCompletionSteps: isYolo
			? getPrompt("gemini3Overrides", "actCompletionYolo")
			: getPrompt("gemini3Overrides", "actCompletionNormal"),
	})
}

export const gemini3ComponentOverrides: PromptVariant["componentOverrides"] = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: GEMINI_3_AGENT_ROLE_TEMPLATE,
	},
	[SystemPromptSection.TOOL_USE]: {
		template: GEMINI_3_TOOL_USE_TEMPLATE,
	},
	[SystemPromptSection.EDITING_FILES]: {
		template: GEMINI_3_EDITING_FILES_TEMPLATE,
	},
	[SystemPromptSection.OBJECTIVE]: {
		template: GEMINI_3_OBJECTIVE_TEMPLATE,
	},
	[SystemPromptSection.RULES]: {
		template: GEMINI_3_RULES_TEMPLATE,
	},
	[SystemPromptSection.FEEDBACK]: {
		template: GEMINI_3_FEEDBACK_TEMPLATE,
	},
	[SystemPromptSection.ACT_VS_PLAN]: {
		template: GEMINI_3_ACT_VS_PLAN_TEMPLATE,
	},
	[SystemPromptSection.TASK_PROGRESS]: {
		template: GEMINI_3_UPDATING_TASK_PROGRESS_TEMPLATE,
	},
}
