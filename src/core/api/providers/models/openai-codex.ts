/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) model definitions.
 * Updated from official OpenAI docs (2026-07-05).
 */

import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiCodexModels: Record<string, ModelInfo> = {
	"gpt-5.6-sol": {
		id: "gpt-5.6-sol",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 353_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.6-terra": {
		id: "gpt-5.6-terra",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 353_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.6-luna": {
		id: "gpt-5.6-luna",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 353_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.4": {
		id: "gpt-5.4",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.4-mini": {
		id: "gpt-5.4-mini",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			supportsTools: true,
			maxTokens: 128_000,
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
}

/** Default model ID for OpenAI Codex provider */
export const openAiCodexDefaultModelId = "gpt-5.6-sol"
