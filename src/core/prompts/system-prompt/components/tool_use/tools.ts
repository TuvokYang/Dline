import { getPrompt } from "../../../i18n"
import { MULTI_ROOT_HINT } from "../../constants"
import { PromptBuilder } from "../../registry/PromptBuilder"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseToolsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled

	const toolSections: string[] = ["# Tools"]

	const toolsTemplates = await PromptBuilder.getToolsPrompts(variant, context)

	toolSections.push(...toolsTemplates)
	const template = toolSections.join("\n\n")

	const shouldIncludeTaskProgress = focusChainEnabled

	const multiRootHint = context.isMultiRootEnabled ? MULTI_ROOT_HINT : ""
	const taskProgressParam = shouldIncludeTaskProgress ? getPrompt("toolUseTools", "taskProgressParam") : ""
	const focusChainAttempt = shouldIncludeTaskProgress ? getPrompt("toolUseTools", "focusChainAttempt") : ""
	const focusChainUsage = shouldIncludeTaskProgress ? getPrompt("toolUseTools", "focusChainUsage") : ""

	return new TemplateEngine().resolve(template, context, {
		TASK_PROGRESS: taskProgressParam,
		FOCUS_CHAIN_ATTEMPT: focusChainAttempt,
		FOCUS_CHAIN_USAGE: focusChainUsage,
		BROWSER_VIEWPORT_WIDTH: context.browserSettings?.viewport?.width || 0,
		BROWSER_VIEWPORT_HEIGHT: context.browserSettings?.viewport?.height || 0,
		CWD: context.cwd,
		MULTI_ROOT_HINT: multiRootHint,
	})
}
