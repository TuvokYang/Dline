import { EmptyRequest } from "@shared/proto/dline/common"
import type { AvailableModelsResponse, ModelInfo } from "@shared/proto/dline/models"
import { useEffect, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

/**
 * Result shape for useProviderModels hook.
 */
export interface ProviderModelsResult {
	models: Record<string, ModelInfo>
	defaultModelId: string
	modelInfoSaneDefaults: ModelInfo
	loading: boolean
}

/**
 * Hook that loads available models for a given provider from ModelRegistry via RPC.
 */
export function useProviderModels(providerId: string): ProviderModelsResult {
	const [models, setModels] = useState<Record<string, ModelInfo>>({})
	const [defaultModelId, setDefaultModelId] = useState<string>("")
	const [modelInfoSaneDefaults, setModelInfoSaneDefaults] = useState<ModelInfo>({} as ModelInfo)
	const [loading, setLoading] = useState<boolean>(true)

	useEffect(() => {
		let cancelled = false
		setLoading(true)

		ModelsServiceClient.getAvailableModels({} as EmptyRequest)
			.then((response: AvailableModelsResponse) => {
				if (cancelled) return
				const group = response.providers?.find((g) => g.provider === providerId)
				if (group) {
					const modelMap: Record<string, ModelInfo> = {}
					for (const m of group.models) {
						modelMap[m.id] = m
					}
					setModels(modelMap)

					const defId = group.defaultModelId || Object.keys(modelMap)[0] || ""
					setDefaultModelId(defId)

					if (defId && modelMap[defId]) {
						setModelInfoSaneDefaults(modelMap[defId])
					} else {
						const first = Object.values(modelMap)[0]
						setModelInfoSaneDefaults(first || ({} as ModelInfo))
					}
				} else {
					setModels({})
					setDefaultModelId("")
					setModelInfoSaneDefaults({} as ModelInfo)
				}
				setLoading(false)
			})
			.catch((err: Error) => {
				console.error(`Failed to load models for provider ${providerId}:`, err)
				if (!cancelled) {
					setLoading(false)
				}
			})

		return () => {
			cancelled = true
		}
	}, [providerId])

	return { models, defaultModelId, modelInfoSaneDefaults, loading }
}
