import { getPrompt } from "../../../i18n"
import { SystemPromptContext } from "../../types"

const XS_EDITING_FILES = getPrompt("xsOverrides", "editingFiles")
const XS_ACT_PLAN_MODE = getPrompt("xsOverrides", "actPlanMode")
const XS_CAPABILITIES = getPrompt("xsOverrides", "capabilities")
const XS_RULES = getPrompt("xsOverrides", "rules")
const XS_OBJECTIVES = getPrompt("xsOverrides", "objectives")

const XS_TOOLS_OVERRIDE = (context: SystemPromptContext) => {
	const subagents = context.subagentsEnabled === true && !context.isSubagentRun ? getPrompt("xsOverrides", "subagents") : ""
	return context.enableNativeToolCalls
		? getPrompt("xsOverrides", "toolsNative", { subagentsSection: subagents })
		: getPrompt("xsOverrides", "toolsXml", { subagentsSection: subagents })
}

export const xsComponentOverrides = {
	AGENT_ROLE: getPrompt("xsOverrides", "agentRole"),
	RULES: XS_RULES,
	ACT_VS_PLAN: XS_ACT_PLAN_MODE,
	CAPABILITIES: XS_CAPABILITIES,
	OBJECTIVE: XS_OBJECTIVES,
	EDITING_FILES: XS_EDITING_FILES,
	TOOL_USE: XS_TOOLS_OVERRIDE,
} as const
