import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getObjectiveSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const yoloAskText =
		context.yoloModeToggled !== true
			? " and instead, ask the user to provide the missing parameters using the ask_followup_question tool"
			: ""

	const defaultTemplate = getPrompt("objective", "main", { yoloAskText })
	const template = variant.componentOverrides?.[SystemPromptSection.OBJECTIVE]?.template || defaultTemplate

	return new TemplateEngine().resolve(template, context, {})
}
