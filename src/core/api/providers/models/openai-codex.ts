/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) model definitions.
 * Updated from official OpenAI docs (2026-07-05).
 */

import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiCodexModels: Record<string, ModelInfo> = {
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
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
			maxTokens: 128_000,
			contextWindow: 1_050_000,
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
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
}

/** Default model ID for OpenAI Codex provider */
export const openAiCodexDefaultModelId = "gpt-5.3-codex"
