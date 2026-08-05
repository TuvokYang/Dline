import type { ModelInfo, ProviderModelsConfig } from "@shared/providers/types"

export type ProviderModelReconciliationMode = "fill-missing" | "refresh-built-ins"

function mergeBuiltInModelDefaults(seed: ModelInfo, stored: ModelInfo): ModelInfo {
	return {
		...seed,
		...stored,
		capabilities: seed.capabilities || stored.capabilities ? { ...seed.capabilities, ...stored.capabilities } : undefined,
		pricing: seed.pricing || stored.pricing ? { ...seed.pricing, ...stored.pricing } : undefined,
		apiFormats: stored.apiFormats ?? seed.apiFormats,
	}
}

/**
 * Reconcile a persisted provider catalog with the current built-in metadata.
 * Explicit and unknown user models are preserved; known built-ins are either
 * refreshed on disk or only enriched in memory, depending on the caller.
 */
export function reconcileProviderModels(
	seed: ProviderModelsConfig,
	stored: ProviderModelsConfig,
	mode: ProviderModelReconciliationMode,
): ProviderModelsConfig {
	if (mode === "fill-missing") {
		return {
			...stored,
			models: Object.fromEntries(
				Object.entries(stored.models).map(([modelId, storedModel]) => {
					const seedModel = seed.models[modelId]
					if (!seedModel || storedModel.userDefined === true) {
						return [modelId, storedModel]
					}
					return [modelId, mergeBuiltInModelDefaults(seedModel, storedModel)]
				}),
			),
		}
	}

	const models: Record<string, ModelInfo> = {}

	for (const [modelId, seedModel] of Object.entries(seed.models)) {
		const storedModel = stored.models[modelId]
		if (storedModel?.userDefined === true) {
			models[modelId] = storedModel
			continue
		}

		models[modelId] = { ...seedModel, userDefined: false }
	}

	for (const [modelId, storedModel] of Object.entries(stored.models)) {
		if (seed.models[modelId] !== undefined) {
			continue
		}
		models[modelId] = { ...storedModel, userDefined: true }
	}

	return {
		...seed,
		...stored,
		models,
	}
}

/** Add the built-in marker to every model in a newly generated seed file. */
export function markBuiltInModels(config: ProviderModelsConfig): ProviderModelsConfig {
	return {
		...config,
		models: Object.fromEntries(
			Object.entries(config.models).map(([modelId, model]) => [modelId, { ...model, userDefined: false }]),
		),
	}
}
