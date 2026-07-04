import { getPrompt } from "../../../i18n"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseExamplesSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled

	return new TemplateEngine().resolve(getPrompt("toolUseExamples", "main"), context, {
		FOCUS_CHAIN_EXAMPLE_BASH: focusChainEnabled ? getPrompt("toolUseExamples", "focusChainBash") : "",
		FOCUS_CHAIN_EXAMPLE_NEW_FILE: focusChainEnabled ? getPrompt("toolUseExamples", "focusChainNewFile") : "",
		FOCUS_CHAIN_EXAMPLE_EDIT: focusChainEnabled ? getPrompt("toolUseExamples", "focusChainEdit") : "",
	})
}
