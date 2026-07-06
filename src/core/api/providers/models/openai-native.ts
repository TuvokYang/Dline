/**
 * OpenAI Native provider model definitions.
 * Updated from official OpenAI docs (2026-07-05).
 */

import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiNativeModels: Record<string, ModelInfo> = {
	// === Frontier Models ===
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
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
			maxTokens: 128_000,
			contextWindow: 400_000,
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
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0.2, outputPrice: 1.25, cacheReadsPrice: 0.02 },
	},

	// === GPT-5.3 Codex ===
	"gpt-5.3-codex": {
		id: "gpt-5.3-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 1.75, outputPrice: 14.0, cacheReadsPrice: 0.175 },
	},

	// === GPT-5.2 ===
	"gpt-5.2": {
		id: "gpt-5.2",
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 1.75, outputPrice: 14.0, cacheReadsPrice: 0.175 },
	},

	// === GPT-5.1 (renamed from gpt-5.1-2025-11-13) ===
	"gpt-5.1": {
		id: "gpt-5.1",
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 1.25, outputPrice: 10.0, cacheReadsPrice: 0.125 },
	},

	// === GPT-5 (renamed from gpt-5-2025-08-07) ===
	"gpt-5": {
		id: "gpt-5",
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 1.25, outputPrice: 10.0, cacheReadsPrice: 0.125 },
	},

	// === GPT-5 mini (renamed from gpt-5-mini-2025-08-07) ===
	"gpt-5-mini": {
		id: "gpt-5-mini",
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0.25, outputPrice: 2.0, cacheReadsPrice: 0.025 },
	},

	// === GPT-5 nano (renamed from gpt-5-nano-2025-08-07) ===
	"gpt-5-nano": {
		id: "gpt-5-nano",
		temperature: 1,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0.05, outputPrice: 0.4, cacheReadsPrice: 0.005 },
	},

	// === Legacy / Non-GPT-5 ===
	o3: {
		id: "o3",
		capabilities: {
			maxTokens: 100_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: { inputPrice: 2.0, outputPrice: 8.0, cacheReadsPrice: 0.5 },
	},
	"gpt-4.1": {
		id: "gpt-4.1",
		temperature: 0,
		capabilities: {
			maxTokens: 32_768,
			contextWindow: 1_047_576,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: { inputPrice: 2, outputPrice: 8, cacheReadsPrice: 0.5 },
	},
	"gpt-4.1-mini": {
		id: "gpt-4.1-mini",
		temperature: 0,
		capabilities: {
			maxTokens: 32_768,
			contextWindow: 1_047_576,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: { inputPrice: 0.4, outputPrice: 1.6, cacheReadsPrice: 0.1 },
	},
	"gpt-4o-mini": {
		id: "gpt-4o-mini",
		temperature: 0,
		capabilities: {
			maxTokens: 16_384,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: { inputPrice: 0.15, outputPrice: 0.6, cacheReadsPrice: 0.075 },
	},
}

/** Default model ID for OpenAI Native provider */
export const openAiNativeDefaultModelId = "gpt-5.5"
