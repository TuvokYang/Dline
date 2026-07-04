/**
 * Handler for getAvailableModels RPC.
 *
 * Returns all available models across configured providers from ModelRegistry,
 * grouped by provider for subagent model selection UI.
 */

import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { AvailableModelsResponse, ModelInfo, ProviderModelGroup } from "@shared/proto/dline/models"
import { ThinkingConfig } from "@shared/proto/dline/models/metadata"
import type { Controller } from ".."

/**
 * Get all available models grouped by provider.
 * Uses layered ModelInfo (proto/dline/models.proto) with capabilities + pricing nesting.
 */
export async function getAvailableModels(_controller: Controller): Promise<AvailableModelsResponse> {
	const registry = ModelRegistry.getInstance()

	if (!registry.isInitialized) {
		await registry.initialize()
	}

	const allModels = registry.getAllModels()

	const providers: ProviderModelGroup[] = allModels.map((group) =>
		ProviderModelGroup.create({
			provider: group.provider,
			providerName: group.providerName,
			defaultModelId: group.defaultModelId,
			models: group.models.map((m) => {
				const cap: Record<string, unknown> = {
					supportsImages: m.capabilities?.supportsImages,
					supportsPromptCache: m.capabilities?.supportsPromptCache,
				}
				if (m.capabilities?.supportsReasoning !== undefined) cap.supportsReasoning = m.capabilities?.supportsReasoning
				if (m.capabilities?.supportsGlobalEndpoint !== undefined)
					cap.supportsGlobalEndpoint = m.capabilities?.supportsGlobalEndpoint
				if (m.capabilities?.maxTokens !== undefined) cap.maxTokens = m.capabilities?.maxTokens
				if (m.capabilities?.contextWindow !== undefined) cap.contextWindow = m.capabilities?.contextWindow
				if (m.capabilities?.thinking) {
					cap.thinking = ThinkingConfig.create({
						maxBudget: m.capabilities?.thinking.maxBudget,
					})
				}

				const pricing: Record<string, unknown> = {}
				let hasPricing = false
				if (m.pricing?.inputPrice !== undefined) {
					pricing.inputPrice = m.pricing.inputPrice
					hasPricing = true
				}
				if (m.pricing?.outputPrice !== undefined) {
					pricing.outputPrice = m.pricing.outputPrice
					hasPricing = true
				}
				if (m.pricing?.cacheWritesPrice !== undefined) {
					pricing.cacheWritesPrice = m.pricing.cacheWritesPrice
					hasPricing = true
				}
				if (m.pricing?.cacheReadsPrice !== undefined) {
					pricing.cacheReadsPrice = m.pricing.cacheReadsPrice
					hasPricing = true
				}
				if (m.pricing?.currency) {
					pricing.currency = m.pricing.currency
					hasPricing = true
				}
				if (m.pricing?.thinkingOutputPrice !== undefined) {
					pricing.thinkingOutputPrice = m.pricing.thinkingOutputPrice
					hasPricing = true
				}

				const modelData: Record<string, unknown> = {
					id: m.id,
					name: m.name || m.id,
					capabilities: cap,
				}
				if (hasPricing) modelData.pricing = pricing
				if (m.description) modelData.description = m.description

				return ModelInfo.create(modelData as any)
			}),
		}),
	)

	return AvailableModelsResponse.create({
		providers,
	})
}
