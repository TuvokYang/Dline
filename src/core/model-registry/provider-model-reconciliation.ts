import type { ImageModelInfo, ModelInfo, ProviderModelsConfig } from "@shared/providers/types"

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

function mergeBuiltInImageModelDefaults(seed: ImageModelInfo, stored: ImageModelInfo): ImageModelInfo {
	return {
		...seed,
		...stored,
		capabilities: seed.capabilities || stored.capabilities ? { ...seed.capabilities, ...stored.capabilities } : undefined,
		pricing: seed.pricing || stored.pricing ? { ...seed.pricing, ...stored.pricing } : undefined,
	}
}

function reconcileImageModels(
	seed: ProviderModelsConfig,
	stored: ProviderModelsConfig,
	mode: ProviderModelReconciliationMode,
): Record<string, ImageModelInfo> | undefined {
	const seedModels = seed.imageModels ?? {}
	const storedModels = stored.imageModels ?? {}
	if (mode === "fill-missing") {
		return Object.fromEntries(
			Object.entries(storedModels).map(([modelId, storedModel]) => {
				const seedModel = seedModels[modelId]
				if (!seedModel || storedModel.userDefined === true) return [modelId, storedModel]
				return [modelId, mergeBuiltInImageModelDefaults(seedModel, storedModel)]
			}),
		)
	}

	const models: Record<string, ImageModelInfo> = {}
	for (const [modelId, seedModel] of Object.entries(seedModels)) {
		const storedModel = storedModels[modelId]
		models[modelId] = storedModel?.userDefined === true ? storedModel : { ...seedModel, userDefined: false }
	}
	for (const [modelId, storedModel] of Object.entries(storedModels)) {
		if (seedModels[modelId] === undefined) models[modelId] = { ...storedModel, userDefined: true }
	}
	return Object.keys(models).length > 0 ? models : undefined
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
			imageModels: reconcileImageModels(seed, stored, mode),
			defaultImageModelId: stored.defaultImageModelId ?? seed.defaultImageModelId,
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
		imageModels: reconcileImageModels(seed, stored, mode),
		defaultImageModelId: stored.defaultImageModelId ?? seed.defaultImageModelId,
	}
}

/** Add the built-in marker to every model in a newly generated seed file. */
export function markBuiltInModels(config: ProviderModelsConfig): ProviderModelsConfig {
	return {
		...config,
		models: Object.fromEntries(
			Object.entries(config.models).map(([modelId, model]) => [modelId, { ...model, userDefined: false }]),
		),
		imageModels: config.imageModels
			? Object.fromEntries(
					Object.entries(config.imageModels).map(([modelId, model]) => [modelId, { ...model, userDefined: false }]),
				)
			: undefined,
	}
}
