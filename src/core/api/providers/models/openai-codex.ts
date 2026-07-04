/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) model definitions.
 * Extracted from api.ts openAiCodexModels (lines 2118-2200).
 */

import type { OpenAiCompatibleModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/dline/models"

export const openAiCodexModels: Record<string, OpenAiCompatibleModelInfo> = {
	"gpt-5.5": {
		id: "gpt-5.5",
		name: "gpt-5.5",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.5 Codex: OpenAI's latest flagship coding model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.4": {
		id: "gpt-5.4",
		name: "gpt-5.4",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.4 Codex: OpenAI's latest flagship coding model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.3-codex": {
		id: "gpt-5.3-codex",
		name: "gpt-5.3-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.3 Codex: OpenAI's latest flagship coding model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.2-codex": {
		id: "gpt-5.2-codex",
		name: "gpt-5.2-codex",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.2 Codex: OpenAI's flagship coding model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.1-codex-max": {
		id: "gpt-5.1-codex-max",
		name: "gpt-5.1-codex-max",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.1 Codex Max: Maximum capability coding model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.1-codex-mini": {
		id: "gpt-5.1-codex-mini",
		name: "gpt-5.1-codex-mini",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.1 Codex Mini: Faster version for coding tasks via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
	"gpt-5.2": {
		id: "gpt-5.2",
		name: "gpt-5.2",
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.2: Latest GPT model via ChatGPT subscription",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 0,
			outputPrice: 0,
		},
	},
}
