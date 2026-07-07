import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"

export interface ProviderModelOverrides {
	capabilities?: ModelCapabilities
	pricing?: ModelPricing
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
	const capabilities = overrides.capabilities
		? (mergeDefined(base.capabilities, overrides.capabilities) as ModelCapabilities)
		: base.capabilities
	const pricing = overrides.pricing ? (mergeDefined(base.pricing, overrides.pricing) as ModelPricing) : base.pricing

	return {
		...base,
		id: modelId ?? base.id ?? "",
		capabilities,
		pricing,
	}
}
