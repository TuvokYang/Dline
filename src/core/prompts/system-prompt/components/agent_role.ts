import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getAgentRoleSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const defaultTemplate = getPrompt("agentRole", "main")
	const template = variant.componentOverrides?.[SystemPromptSection.AGENT_ROLE]?.template || defaultTemplate

	return new TemplateEngine().resolve(template, context, {})
}
