import { EmptyRequest } from "@shared/proto/dline/common"
import type { AvailableModelsResponse, ModelInfo, ProviderModelGroup } from "@shared/proto/dline/models"
import { useEffect, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

export interface ProviderModelsResult {
	models: Record<string, ModelInfo>
	defaultModelId: string
	modelInfoSaneDefaults: ModelInfo
	loading: boolean
	error?: Error
}

let sharedCatalog: ProviderModelGroup[] = []
let sharedCatalogLoaded = false
let sharedCatalogError: Error | undefined
let sharedCatalogPromise: Promise<void> | undefined
const catalogListeners = new Set<() => void>()

function notifyCatalogListeners(): void {
	for (const listener of catalogListeners) listener()
}

function loadModelCatalog(): Promise<void> {
	if (sharedCatalogLoaded) return Promise.resolve()
	if (sharedCatalogPromise) return sharedCatalogPromise

	const request = ModelsServiceClient.getAvailableModels({} as EmptyRequest)
		.then((response: AvailableModelsResponse) => {
			sharedCatalog = response.providers || []
			sharedCatalogLoaded = true
			sharedCatalogError = undefined
			notifyCatalogListeners()
		})
		.catch((error: unknown) => {
			sharedCatalogError = error instanceof Error ? error : new Error(String(error))
			notifyCatalogListeners()
		})
		.finally(() => {
			if (sharedCatalogPromise === request) sharedCatalogPromise = undefined
		})

	sharedCatalogPromise = request
	return request
}

export function getCachedProviderDefaultModelId(providerId: string): string {
	const group = sharedCatalog.find((item) => item.provider === providerId)
	return group?.defaultModelId || group?.models[0]?.id || ""
}

/** All consumers share one registry catalog RPC instead of loading all models per card/editor. */
export function useProviderModels(providerId: string): ProviderModelsResult {
	const [, forceRender] = useState(0)

	useEffect(() => {
		const listener = () => forceRender((value) => value + 1)
		catalogListeners.add(listener)
		void loadModelCatalog()
		return () => {
			catalogListeners.delete(listener)
		}
	}, [])

	const group = sharedCatalog.find((item) => item.provider === providerId)
	const models: Record<string, ModelInfo> = {}
	for (const model of group?.models || []) models[model.id] = model
	const defaultModelId = getCachedProviderDefaultModelId(providerId)
	const modelInfoSaneDefaults = models[defaultModelId] || Object.values(models)[0] || ({} as ModelInfo)

	return {
		models,
		defaultModelId,
		modelInfoSaneDefaults,
		loading: !sharedCatalogLoaded && !sharedCatalogError,
		error: sharedCatalogError,
	}
}
