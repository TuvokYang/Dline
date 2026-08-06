import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { buildEffectiveModelInfo, type ProviderModelOverrides } from "./effective-model-info"
import type { ProviderModelsConfig } from "./types"

export const PROFILE_PROVIDER_KEYS: Partial<Record<string, keyof ApiProfile>> = {
	aihubmix: "aihubmix",
	anthropic: "anthropic",
	asksage: "asksage",
	baseten: "baseten",
	bedrock: "bedrock",
	"claude-code": "claudeCode",
	cline: "clineProvider",
	cerebras: "cerebras",
	deepseek: "deepseek",
	dify: "dify",
	doubao: "doubao",
	fireworks: "fireworks",
	gemini: "gemini",
	groq: "groq",
	hicap: "hicap",
	"huawei-cloud-maas": "huaweiCloudMaas",
	huggingface: "huggingface",
	litellm: "litellm",
	lmstudio: "lmstudio",
	minimax: "minimax",
	mistral: "mistral",
	moonshot: "moonshot",
	nebius: "nebius",
	nousResearch: "nousResearch",
	oca: "oca",
	ollama: "ollama",
	openai: "openai",
	"openai-codex": "openaiCodex",
	openrouter: "openrouter",
	qwen: "qwen",
	"qwen-code": "qwenCode",
	requesty: "requesty",
	sambanova: "sambanova",
	sapaicore: "sapaicore",
	together: "together",
	"vercel-ai-gateway": "vercelAiGateway",
	vertex: "vertex",
	"vscode-lm": "vscodeLm",
	wandb: "wandb",
	xai: "xai",
	zai: "zai",
}

/**
 * Check whether an unknown value is a plain object.
 *
 * @param value Value to inspect.
 * @returns True when the value can be read as an object record.
 */

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Extract provider capability and pricing overrides from a profile field.
 *
 * @param value Provider-specific config value from ApiProfile.
 * @returns ModelInfo override fields stored in provider config.
 */

function readOverrides(value: unknown): ProviderModelOverrides {
	if (!isObject(value)) {
		return {}
	}

	const capabilities = isObject(value.capabilities) ? (value.capabilities as ModelCapabilities) : undefined

	const pricing = isObject(value.pricing) ? (value.pricing as ModelPricing) : undefined
	const enableLongContext = typeof value.enableLongContext === "boolean" ? value.enableLongContext : undefined
	const pricingTiersEnabled = typeof value.pricingTiersEnabled === "boolean" ? value.pricingTiersEnabled : undefined

	return { capabilities, pricing, enableLongContext, pricingTiersEnabled }
}

/**
 * Resolve provider-specific capability and pricing overrides for a profile.
 *
 * @param profile Profile containing provider-specific config.
 * @returns Provider model override fields.
 */

export function resolveProfileOverrides(profile: ApiProfile): ProviderModelOverrides {
	const providerKey = PROFILE_PROVIDER_KEYS[profile.provider]

	return providerKey ? readOverrides(profile[providerKey]) : {}
}

/**
 * Resolve the selected model id from profile and provider registry metadata.
 *
 * @param profile Profile containing model selection.
 * @param providerModels Optional registry metadata for the provider.
 * @returns Effective selected model id.
 */

export function resolveProfileModelId(
	profile: ApiProfile,
	providerModels?: Pick<ProviderModelsConfig, "defaultModelId">,
): string {
	return profile.modelId || providerModels?.defaultModelId || profile.modelInfo?.id || ""
}

/**
 * Build effective ModelInfo from ApiProfile, registry metadata, and provider overrides.
 *
 * @param profile Profile containing provider and model selection.
 * @param providerModels Optional provider registry metadata.
 * @returns Effective model metadata for runtime and UI use.
 */

export function resolveProfileModelInfo(
	profile: ApiProfile,

	providerModels?: Pick<ProviderModelsConfig, "models" | "defaultModelId">,
): ModelInfo {
	const modelId = resolveProfileModelId(profile, providerModels)

	const registryModel = modelId ? providerModels?.models?.[modelId] : undefined

	const defaultModel = providerModels?.defaultModelId ? providerModels.models[providerModels.defaultModelId] : undefined

	const baseModel = registryModel ?? profile.modelInfo ?? (profile.modelId ? undefined : defaultModel)

	return buildEffectiveModelInfo(modelId || baseModel?.id, baseModel, resolveProfileOverrides(profile))
}
