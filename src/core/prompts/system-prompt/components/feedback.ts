import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getFeedbackSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	const defaultTemplate = getPrompt("feedback", "main")
	const template = variant.componentOverrides?.[SystemPromptSection.FEEDBACK]?.template || defaultTemplate

	return new TemplateEngine().resolve(template, context, {})
}
