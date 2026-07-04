import { ModelFamily } from "@/shared/prompts"
import { getPrompt } from "../../i18n"
import { PromptVariant, SystemPromptContext, SystemPromptSection, TemplateEngine } from ".."

export async function getUpdatingTaskProgress(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	if (variant.componentOverrides?.[SystemPromptSection.TASK_PROGRESS]?.template) {
		const template = variant.componentOverrides[SystemPromptSection.TASK_PROGRESS].template
		return new TemplateEngine().resolve(template, context, {})
	}

	let template = getPrompt("taskProgress", "generic")
	if (variant.id === ModelFamily.NATIVE_NEXT_GEN) {
		template = getPrompt("taskProgress", "nativeNextGen")
	}
	if (variant.id === ModelFamily.NATIVE_GPT_5) {
		template = getPrompt("taskProgress", "nativeGpt5")
	}

	return new TemplateEngine().resolve(template, context, {})
}
