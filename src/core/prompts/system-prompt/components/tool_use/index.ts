import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"
import { getToolUseExamplesSection } from "./examples"
import { getToolUseFormattingSection } from "./formatting"
import { getToolUseGuidelinesSection } from "./guidelines"
import { getToolUseToolsSection } from "./tools"

export async function getToolUseSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const defaultTemplate = getPrompt("toolUseIndex", "main")
	const template = variant.componentOverrides?.[SystemPromptSection.TOOL_USE]?.template || defaultTemplate

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		TOOL_USE_FORMATTING_SECTION: await getToolUseFormattingSection(variant, context),
		TOOLS_SECTION: await getToolUseToolsSection(variant, context),
		TOOL_USE_EXAMPLES_SECTION: await getToolUseExamplesSection(variant, context),
		TOOL_USE_GUIDELINES_SECTION: await getToolUseGuidelinesSection(variant, context),
		CWD: context.cwd,
	})
}
