import { isGPT5ModelFamily, isGptOssModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { SystemPromptSection } from "../../templates/placeholders"
import { ADVANCED_TOOLS, BASIC_TOOLS, ORCHESTRATION_TOOLS, STANDARD_EDIT } from "../tools"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { gpt5ComponentOverrides } from "./overrides"
import { GPT_5_TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_GPT_5)
	.description("Prompt tailored to GPT-5 with native tool use support with less strict rules than GPT-5.1 variant")
	.version(1)
	.tags("gpt", "gpt-5", "advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	// Match GPT-5 models from providers that support native tools
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		const modelId = providerInfo.model.id
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		if (isGptOssModelFamily(modelId)) {
			return true
		}
		return (
			isGPT5ModelFamily(modelId) &&
			// gpt-5-chat models do not support native tool use
			!modelId.includes("chat") &&
			isNextGenModelProvider(providerInfo)
		)
	})
	.template(GPT_5_TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(...STANDARD_EDIT, ...BASIC_TOOLS, ...ADVANCED_TOOLS, ...ORCHESTRATION_TOOLS)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_GPT_5,
	})
	.config({})
	// i18n-based component overrides (inherited from native-gpt-5-1)
	.overrideComponent(SystemPromptSection.AGENT_ROLE, gpt5ComponentOverrides[SystemPromptSection.AGENT_ROLE]!)
	.overrideComponent(SystemPromptSection.RULES, gpt5ComponentOverrides[SystemPromptSection.RULES]!)
	.overrideComponent(SystemPromptSection.TOOL_USE, gpt5ComponentOverrides[SystemPromptSection.TOOL_USE]!)
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, gpt5ComponentOverrides[SystemPromptSection.ACT_VS_PLAN]!)
	.overrideComponent(SystemPromptSection.OBJECTIVE, gpt5ComponentOverrides[SystemPromptSection.OBJECTIVE]!)
	.overrideComponent(SystemPromptSection.FEEDBACK, gpt5ComponentOverrides[SystemPromptSection.FEEDBACK]!)
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_GPT_5 }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("GPT-5 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("GPT-5 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT5VariantConfig = typeof config
