import type { ModelInfo } from "@shared/proto/dline/models"
import { ProviderModelsRequest } from "@shared/proto/dline/models"
import { useCallback, useMemo } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useModelProbe } from "./useModelProbe"
import { useProviderModels, type ProviderModelsResult } from "./useProviderModels"

export interface ProviderModelOptions extends ProviderModelsResult {
	/**
	 * Local catalog entries merged with the ids the provider currently lists.
	 * Catalog metadata wins, so remote discovery only adds models the local
	 * registry does not know about yet.
	 */
	options: Record<string, ModelInfo>
	/** Triggers a listing request; safe to bind to a picker's `onOpen`. */
	refreshRemoteModels: () => void
}

export interface ProviderModelOptionsInput {
	providerId: string
	/** Unsaved base URL from the settings form; empty falls back to saved credentials. */
	baseUrl?: string
	/** Unsaved API key from the settings form; empty falls back to saved credentials. */
	apiKey?: string
	/** Kept in the list so the current selection stays visible before a listing returns. */
	selectedModelId?: string
}

/**
 * The model picker's data source.
 *
 * A provider's models come from two places: the local catalog, which carries
 * pricing and capabilities, and the vendor's listing endpoint, which knows
 * about models released after the catalog was written. Both belong in the same
 * dropdown, so the merge lives here instead of in each provider component.
 */
export function useProviderModelOptions({
	providerId,
	baseUrl,
	apiKey,
	selectedModelId,
}: ProviderModelOptionsInput): ProviderModelOptions {
	const catalog = useProviderModels(providerId)

	const probe = useCallback(async () => {
		const response = await ModelsServiceClient.refreshProviderModels(
			ProviderModelsRequest.create({ providerId, baseUrl, apiKey }),
		)
		return response.values
	}, [apiKey, baseUrl, providerId])

	// The probe hook synthesizes entries from a template; the catalog defaults
	// keep a discovered model's context window realistic until it is selected.
	const { models: discovered, refresh: refreshRemoteModels } = useModelProbe({
		probe,
		enabled: true,
		template: catalog.modelInfoSaneDefaults,
	})

	const options = useMemo<Record<string, ModelInfo>>(() => {
		const merged: Record<string, ModelInfo> = { ...discovered, ...catalog.models }
		if (selectedModelId && !merged[selectedModelId]) {
			merged[selectedModelId] = { ...catalog.modelInfoSaneDefaults, id: selectedModelId, name: selectedModelId }
		}
		return merged
	}, [catalog.models, catalog.modelInfoSaneDefaults, discovered, selectedModelId])

	return { ...catalog, options, refreshRemoteModels }
}
