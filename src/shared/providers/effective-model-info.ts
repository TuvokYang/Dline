import type { ModelInfo } from "@shared/proto/dline/models"
import type { ContextWindowTier, ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"

export interface ProviderModelOverrides {
	capabilities?: ModelCapabilities
	pricing?: ModelPricing
	enableLongContext?: boolean
	pricingTiersEnabled?: boolean
}

/**
 * Merge provider override fields while dropping generated undefined values.
 *
 * @param base Existing provider override object.
 * @param updates Partial override update from the UI.
 * @returns Merged override object without undefined-valued keys.
 */
export function mergeDefined<T extends object>(base: T | undefined, updates: Partial<T>): Partial<T> {
	const baseEntries = Object.entries(base ?? {}).filter(([, value]) => value !== undefined)
	const updateEntries = Object.entries(updates).filter(([, value]) => value !== undefined)
	return Object.fromEntries([...baseEntries, ...updateEntries]) as Partial<T>
}

/**
 * Merge provider capability overrides without preserving undefined fields.
 *
 * @param base Existing provider capability overrides.
 * @param updates Partial capability updates.
 * @returns Merged capability overrides.
 */
export function mergeCapabilities(base: ModelCapabilities | undefined, updates: Partial<ModelCapabilities>): ModelCapabilities {
	return mergeDefined(base, updates) as ModelCapabilities
}

/**
 * Merge provider pricing overrides without preserving undefined fields.
 *
 * @param base Existing provider pricing overrides.
 * @param updates Partial pricing updates.
 * @returns Merged pricing overrides.
 */
export function mergePricing(base: ModelPricing | undefined, updates: Partial<ModelPricing>): ModelPricing {
	return mergeDefined(base, updates) as ModelPricing
}

/**
 * Select the context tier represented by a provider configuration.
 *
 * @param capabilities Model capabilities containing selectable context tiers.
 * @param enableLongContext Whether the provider's long-context option is enabled.
 * @returns Selected context tier, or undefined when the model has no tiers.
 */
export function selectContextTier(
	capabilities: ModelCapabilities | undefined,
	enableLongContext: boolean | undefined,
): ContextWindowTier | undefined {
	const tiers = capabilities?.contextWindowTiers ?? []
	if (tiers.length === 0) {
		return undefined
	}

	if (enableLongContext === true) {
		return tiers.find((tier) => tier.id === "long") ?? [...tiers].sort((a, b) => b.contextWindow - a.contextWindow)[0]
	}

	return (
		tiers.find((tier) => tier.id === "standard") ??
		tiers.find((tier) => tier.contextWindow === capabilities?.contextWindow) ??
		[...tiers].sort((a, b) => a.contextWindow - b.contextWindow)[0]
	)
}

/**
 * Build effective model metadata from registry metadata and provider overrides.
 *
 * @param modelId Selected model id, if any.
 * @param registryModel Model metadata loaded from provider registry.
 * @param overrides Provider-specific capability and pricing overrides.
 * @returns Effective model metadata for display and request handling.
 */
export function buildEffectiveModelInfo(
	modelId: string | undefined,
	registryModel: ModelInfo | undefined,
	overrides: ProviderModelOverrides,
): ModelInfo {
	const base: ModelInfo = registryModel ?? ({ id: modelId ?? "" } as ModelInfo)
	const mergedCapabilities = overrides.capabilities
		? (mergeDefined(base.capabilities, overrides.capabilities) as ModelCapabilities)
		: base.capabilities
	// An explicit provider context window must win over inherited context tiers;
	// tier selection only applies when the provider did not override the window.
	const explicitContextWindow = overrides.capabilities?.contextWindow
	const contextTier =
		explicitContextWindow === undefined ? selectContextTier(mergedCapabilities, overrides.enableLongContext) : undefined
	const capabilities = {
		...mergedCapabilities,
		...(contextTier ? { contextWindow: contextTier.contextWindow } : {}),
		supportsPromptCache: mergedCapabilities?.supportsPromptCache ?? true,
	} as ModelCapabilities
	const mergedPricing = overrides.pricing ? (mergeDefined(base.pricing, overrides.pricing) as ModelPricing) : base.pricing
	const overrideTiers = overrides.pricing?.tiers ?? []
	const selectedTiers = overrides.pricingTiersEnabled === true ? overrideTiers : base.pricing?.tiers
	const pricing = mergedPricing
		? ({ ...mergedPricing, ...(selectedTiers !== undefined && { tiers: selectedTiers }) } as ModelPricing)
		: selectedTiers !== undefined
			? ({ tiers: selectedTiers } as ModelPricing)
			: undefined

	return {
		...base,
		id: modelId ?? base.id ?? "",
		capabilities,
		pricing,
	}
}
