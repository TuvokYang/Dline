import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getEditingFilesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const defaultTemplate = getPrompt("editingFiles", "main")
	const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || defaultTemplate

	const autoFormattingSection = context.isCliEnvironment ? "" : getPrompt("editingFiles", "autoFormatting")

	return new TemplateEngine().resolve(template, context, {
		AUTO_FORMATTING_SECTION: autoFormattingSection,
	})
}
