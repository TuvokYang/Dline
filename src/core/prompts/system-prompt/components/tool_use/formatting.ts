import { getPrompt } from "../../../i18n"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseFormattingSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = getPrompt("toolUseFormatting", "main")

	const focusChainEnabled = context.focusChainSettings?.enabled

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		FOCUS_CHATIN_FORMATTING: focusChainEnabled ? getPrompt("toolUseFormatting", "focusChainExample") : "",
	})
}
