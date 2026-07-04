import { getPrompt } from "../../../i18n"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseGuidelinesSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	return new TemplateEngine().resolve(getPrompt("toolUseGuidelines", "main"), context, {})
}
