import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

/**
 * Generate the TODO section (Focus Chain) for the system prompt.
 * Describes the Focus Chain / task_progress tracking system concept
 * and how the AI should interact with it.
 *
 * @param variant The current prompt variant configuration
 * @param context The system prompt context with all dynamic settings
 * @returns The TODO section text, or undefined if focus chain is disabled
 */
export async function getTodoSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	// Only output when focus chain feature is enabled
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	// Support variant-level component override for model-specific wording
	if (variant.componentOverrides?.[SystemPromptSection.TODO]?.template) {
		const template = variant.componentOverrides[SystemPromptSection.TODO].template
		return new TemplateEngine().resolve(template, context, {})
	}

	return getPrompt("focusChain", "main")
}
