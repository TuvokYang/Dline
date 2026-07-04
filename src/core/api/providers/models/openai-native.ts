/**
 * OpenAI Native provider model definitions.
 * Extracted from api.ts openAiNativeModels (lines 1743-2111).
 */

import type { OpenAiCompatibleModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiNativeModels: Record<string, OpenAiCompatibleModelInfo> = {
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 30.0,
			cacheReadsPrice: 0.5,
		},
	},
	"gpt-5.4": {
		id: "gpt-5.4",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 1_050_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 2.5,
			outputPrice: 15.0,
			cacheReadsPrice: 0.25,
		},
	},
	"gpt-5.4-mini": {
		id: "gpt-5.4-mini",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0.75,
			outputPrice: 4.5,
			cacheReadsPrice: 0.075,
		},
	},
	"gpt-5.4-nano": {
		id: "gpt-5.4-nano",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0.2,
			outputPrice: 1.25,
			cacheReadsPrice: 0.02,
		},
	},
	"gpt-5.3-codex": {
		id: "gpt-5.3-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.75,
			outputPrice: 14.0,
			cacheReadsPrice: 0.175,
		},
	},
	"gpt-5.3-chat-latest": {
		id: "gpt-5.3-chat-latest",
		temperature: 1,
		capabilities: {
			maxTokens: 16_384,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 1.75,
			outputPrice: 14.0,
			cacheReadsPrice: 0.175,
		},
	},
	"gpt-5.2-chat-latest": {
		id: "gpt-5.2-chat-latest",
		temperature: 1,
		capabilities: {
			maxTokens: 16_384,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 1.75,
			outputPrice: 14.0,
			cacheReadsPrice: 0.175,
		},
	},
	"gpt-5.2": {
		id: "gpt-5.2",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.75,
			outputPrice: 14.0,
			cacheReadsPrice: 0.175,
		},
	},
	"gpt-5.2-codex": {
		id: "gpt-5.2-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.75,
			outputPrice: 14.0,
			cacheReadsPrice: 0.175,
		},
	},
	"gpt-5.1-2025-11-13": {
		id: "gpt-5.1-2025-11-13",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10.0,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5.1": {
		id: "gpt-5.1",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10.0,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5.1-codex": {
		id: "gpt-5.1-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10.0,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5.1-chat-latest": {
		id: "gpt-5.1-chat-latest",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5-2025-08-07": {
		id: "gpt-5-2025-08-07",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10.0,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5-codex": {
		id: "gpt-5-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10.0,
			cacheReadsPrice: 0.125,
		},
	},
	"gpt-5-mini-2025-08-07": {
		id: "gpt-5-mini-2025-08-07",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0.25,
			outputPrice: 2.0,
			cacheReadsPrice: 0.025,
		},
	},
	"gpt-5-nano-2025-08-07": {
		id: "gpt-5-nano-2025-08-07",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 272000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0.05,
			outputPrice: 0.4,
			cacheReadsPrice: 0.005,
		},
	},
	"gpt-5-chat-latest": {
		id: "gpt-5-chat-latest",
		temperature: 1,
		capabilities: {
			maxTokens: 8_192,
			contextWindow: 400000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.25,
			outputPrice: 10,
			cacheReadsPrice: 0.125,
		},
	},
	o3: {
		id: "o3",
		capabilities: {
			maxTokens: 100_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 2.0,
			outputPrice: 8.0,
			cacheReadsPrice: 0.5,
		},
	},
	"o4-mini": {
		id: "o4-mini",
		capabilities: {
			maxTokens: 100_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.1,
			outputPrice: 4.4,
			cacheReadsPrice: 0.275,
		},
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
		pricing: {
			inputPrice: 2,
			outputPrice: 8,
			cacheReadsPrice: 0.5,
		},
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
		pricing: {
			inputPrice: 0.4,
			outputPrice: 1.6,
			cacheReadsPrice: 0.1,
		},
	},
	"gpt-4.1-nano": {
		id: "gpt-4.1-nano",
		temperature: 0,
		capabilities: {
			maxTokens: 32_768,
			contextWindow: 1_047_576,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 0.1,
			outputPrice: 0.4,
			cacheReadsPrice: 0.025,
		},
	},
	"o3-mini": {
		id: "o3-mini",
		capabilities: {
			maxTokens: 100_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1.1,
			outputPrice: 4.4,
			cacheReadsPrice: 0.55,
		},
	},
	o1: {
		id: "o1",
		capabilities: {
			maxTokens: 100_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: false,
		},
		pricing: {
			inputPrice: 15,
			outputPrice: 60,
			cacheReadsPrice: 7.5,
		},
	},
	"o1-preview": {
		id: "o1-preview",
		capabilities: {
			maxTokens: 32_768,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 15,
			outputPrice: 60,
			cacheReadsPrice: 7.5,
		},
	},
	"o1-mini": {
		id: "o1-mini",
		capabilities: {
			maxTokens: 65_536,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 1.1,
			outputPrice: 4.4,
			cacheReadsPrice: 0.55,
		},
	},
	"gpt-4o": {
		id: "gpt-4o",
		temperature: 0,
		capabilities: {
			maxTokens: 4_096,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 2.5,
			outputPrice: 10,
			cacheReadsPrice: 1.25,
		},
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
		pricing: {
			inputPrice: 0.15,
			outputPrice: 0.6,
			cacheReadsPrice: 0.075,
		},
	},
	"chatgpt-4o-latest": {
		id: "chatgpt-4o-latest",
		temperature: 0,
		capabilities: {
			maxTokens: 16_384,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: false,
		},
		pricing: {
			inputPrice: 5,
			outputPrice: 15,
		},
	},
}
