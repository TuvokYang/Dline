/**
 * OpenAI Native provider model definitions.
 * Updated from official OpenAI docs (2026-07-05).
 */

import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiNativeModels: Record<string, ModelInfo> = {
	// === Frontier Models ===
	"gpt-5.6-sol": {
		id: "gpt-5.6-sol",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 272_000, label: "272K" },
				{ id: "long", contextWindow: 1_050_000, label: "1.05M" },
			],
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: {
			inputPrice: 5,
			outputPrice: 30,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
			tiers: [
				{ contextWindow: 272_000, inputPrice: 5, outputPrice: 30, cacheWritesPrice: 6.25, cacheReadsPrice: 0.5 },
				{ contextWindow: 1_050_000, inputPrice: 10, outputPrice: 45, cacheWritesPrice: 12.5, cacheReadsPrice: 1 },
			],
		},
	},
	"gpt-5.6-terra": {
		id: "gpt-5.6-terra",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 272_000, label: "272K" },
				{ id: "long", contextWindow: 1_050_000, label: "1.05M" },
			],
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: {
			inputPrice: 2.5,
			outputPrice: 15,
			cacheWritesPrice: 3.125,
			cacheReadsPrice: 0.25,
			tiers: [
				{ contextWindow: 272_000, inputPrice: 2.5, outputPrice: 15, cacheWritesPrice: 3.125, cacheReadsPrice: 0.25 },
				{ contextWindow: 1_050_000, inputPrice: 5, outputPrice: 22.5, cacheWritesPrice: 6.25, cacheReadsPrice: 0.5 },
			],
		},
	},
	"gpt-5.6-luna": {
		id: "gpt-5.6-luna",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 272_000, label: "272K" },
				{ id: "long", contextWindow: 1_050_000, label: "1.05M" },
			],
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: {
			inputPrice: 1,
			outputPrice: 6,
			cacheWritesPrice: 1.25,
			cacheReadsPrice: 0.1,
			tiers: [
				{ contextWindow: 272_000, inputPrice: 1, outputPrice: 6, cacheWritesPrice: 1.25, cacheReadsPrice: 0.1 },
				{ contextWindow: 1_050_000, inputPrice: 2, outputPrice: 9, cacheWritesPrice: 2.5, cacheReadsPrice: 0.2 },
			],
		},
	},
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 5.0, outputPrice: 30.0, cacheReadsPrice: 0.5 },
	},
	"gpt-5.5-pro": {
		id: "gpt-5.5-pro",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: false,
		},
		pricing: { inputPrice: 30.0, outputPrice: 180.0 },
	},
	"gpt-5.4": {
		id: "gpt-5.4",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 2.5, outputPrice: 15.0, cacheReadsPrice: 0.25 },
	},
	"gpt-5.4-pro": {
		id: "gpt-5.4-pro",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 30.0, outputPrice: 180.0 },
	},
	"gpt-5.4-mini": {
		id: "gpt-5.4-mini",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0.75, outputPrice: 4.5, cacheReadsPrice: 0.075 },
	},
	"gpt-5.4-nano": {
		id: "gpt-5.4-nano",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0.2, outputPrice: 1.25, cacheReadsPrice: 0.02 },
	},
}

/** Default model ID for OpenAI Native provider */
export const openAiNativeDefaultModelId = "gpt-5.6-sol"
