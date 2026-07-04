import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getRulesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const yoloAskRule = context.yoloModeToggled !== true ? getPrompt("rules", "yoloAskRule") : getPrompt("rules", "yoloNoAskRule")
	const yoloOutputRule = context.yoloModeToggled !== true ? getPrompt("rules", "yoloOutputRule") : ""

	const defaultTemplate = getPrompt("rules", "main", { yoloAskRule, yoloOutputRule })
	const template = variant.componentOverrides?.[SystemPromptSection.RULES]?.template || defaultTemplate

	const browserRules = context.supportsBrowserUse ? getPrompt("rules", "browserRules") : ""
	const browserWaitRules = context.supportsBrowserUse ? getPrompt("rules", "browserWaitRules") : ""
	const cliRules = context.isCliEnvironment ? getPrompt("rules", "cliRules") : ""

	return new TemplateEngine().resolve(template, context, {
		CWD: context.cwd || process.cwd(),
		BROWSER_RULES: browserRules,
		BROWSER_WAIT_RULES: browserWaitRules,
		CLI_RULES: cliRules,
	})
}
