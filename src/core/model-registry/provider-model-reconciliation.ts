import type { ModelInfo, ProviderModelsConfig } from "@shared/providers/types"

export type ProviderModelReconciliationMode = "fill-missing" | "refresh-built-ins" | "overlay-remote" | "replace"

function mergeBuiltInModelDefaults(seed: ModelInfo, stored: ModelInfo): ModelInfo {
	return {
		...seed,
		...stored,
		capabilities: seed.capabilities || stored.capabilities ? { ...seed.capabilities, ...stored.capabilities } : undefined,
		pricing: seed.pricing || stored.pricing ? { ...seed.pricing, ...stored.pricing } : undefined,
		apiFormats: stored.apiFormats ?? seed.apiFormats,
	}
}

/** Drop keys whose value is undefined so that a spread never erases an existing field. */
function withoutUndefined<T extends object>(source: T): Partial<T> {
	return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as Partial<T>
}

/**
 * Overlay one remote listing entry on top of the stored model.
 *
 * Vendor listings are a supplement to the local catalog rather than a
 * replacement: fields the vendor does not report keep their stored values. This
 * matters most for pricing, which several listing endpoints omit entirely.
 */
function overlayRemoteModel(remote: ModelInfo, stored: ModelInfo): ModelInfo {
	return {
		...stored,
		...withoutUndefined(remote),
		capabilities:
			remote.capabilities || stored.capabilities
				? { ...stored.capabilities, ...(remote.capabilities ? withoutUndefined(remote.capabilities) : {}) }
				: undefined,
		pricing: remote.pricing ? { ...stored.pricing, ...withoutUndefined(remote.pricing) } : stored.pricing,
		apiFormats: remote.apiFormats ?? stored.apiFormats,
		userDefined: stored.userDefined === true ? true : false,
	}
}

/**
 * Merge a remote catalog into the stored one.
 *
 * Models the vendor no longer lists are kept, because a listing outage must not
 * erase a working local configuration. Explicit user models are never touched.
 */
function overlayRemoteModels(remote: ProviderModelsConfig, stored: ProviderModelsConfig): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {}

	for (const [modelId, storedModel] of Object.entries(stored.models)) {
		models[modelId] = storedModel
	}

	for (const [modelId, remoteModel] of Object.entries(remote.models)) {
		const storedModel = stored.models[modelId]
		if (storedModel?.userDefined === true) {
			continue
		}
		models[modelId] = storedModel ? overlayRemoteModel(remoteModel, storedModel) : { ...remoteModel, userDefined: false }
	}

	return models
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
	if (mode === "replace") {
		return seed
	}

	if (mode === "overlay-remote") {
		return {
			...stored,
			...seed,
			models: overlayRemoteModels(seed, stored),
		}
	}

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
