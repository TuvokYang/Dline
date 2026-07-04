/**
 * DeepSeek provider model definitions.
 * Extracted from api.ts deepSeekModels (lines 2213-2238).
 */
import type { ModelInfo } from "@shared/api"

export const deepSeekModels: Record<string, ModelInfo> = {
	"deepseek-v4-pro": {
		id: "deepseek-v4-pro",
		name: "deepseek-v4-pro",
		capabilities: {
			maxTokens: 384_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3,
			outputPrice: 6,
			cacheWritesPrice: 3,
			cacheReadsPrice: 0.025,
			currency: "CNY",
		},
	},
	"deepseek-v4-flash": {
		id: "deepseek-v4-flash",
		name: "deepseek-v4-flash",
		capabilities: {
			maxTokens: 384_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1,
			outputPrice: 2,
			cacheWritesPrice: 1,
			cacheReadsPrice: 0.02,
			currency: "CNY",
		},
	},
}
