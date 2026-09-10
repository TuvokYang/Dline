/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) model definitions.
 * Updated from the official Codex model catalog (2026-09-10).
 */

import type { ModelInfo } from "@shared/api"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"

/** Provider baseline used for newly listed Codex models that are not in the bundled catalog yet. */
export const openAiCodexModelInfoSaneDefaults: Omit<ModelInfo, "id"> = {
	apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
	capabilities: {
		supportsTools: true,
		tools: [ServerTool.WEB_SEARCH],
		maxTokens: 128_000,
		contextWindow: 372_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
		supportsStreaming: true,
	},
	pricing: { inputPrice: 0, outputPrice: 0 },
}

export const openAiCodexModels: Record<string, ModelInfo> = {
	"gpt-6-astra": {
		id: "gpt-6-astra",
		name: "GPT-6-Astra",
		description: "Our most capable model for complex, demanding work.",
		apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
		capabilities: {
			supportsTools: true,
			tools: [ServerTool.WEB_SEARCH],
			maxTokens: 128_000,
			contextWindow: 372_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.6-sol": {
		id: "gpt-5.6-sol",
		apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
		capabilities: {
			supportsTools: true,
			tools: [ServerTool.WEB_SEARCH],
			maxTokens: 128_000,
			contextWindow: 372_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.6-terra": {
		id: "gpt-5.6-terra",
		apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
		capabilities: {
			supportsTools: true,
			tools: [ServerTool.WEB_SEARCH],
			maxTokens: 128_000,
			contextWindow: 372_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.6-luna": {
		id: "gpt-5.6-luna",
		apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
		capabilities: {
			supportsTools: true,
			tools: [ServerTool.WEB_SEARCH],
			maxTokens: 128_000,
			contextWindow: 372_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsStreaming: true,
		},
		pricing: { inputPrice: 0, outputPrice: 0 },
	},
	"gpt-5.5": {
		id: "gpt-5.5",
		apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE],
		capabilities: {
			supportsTools: true,
			tools: [ServerTool.WEB_SEARCH],
			maxTokens: 128_000,
			contextWindow: 372_000,
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
