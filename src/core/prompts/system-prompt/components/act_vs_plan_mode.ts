import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getActVsPlanModeSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const yoloAskText =
		context.yoloModeToggled !== true
			? " You may also ask the user clarifying questions with ask_followup_question to get a better understanding of the task."
			: ""

	const defaultTemplate = getPrompt("actVsPlanMode", "main", { yoloAskText })
	const template = variant.componentOverrides?.[SystemPromptSection.ACT_VS_PLAN]?.template || defaultTemplate

	return new TemplateEngine().resolve(template, context, {})
}
