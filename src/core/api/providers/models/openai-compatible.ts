/**
 * OpenAI-compatible provider constants.
 */

import type { ModelInfo } from "@shared/api"

/** Default ModelInfo for OpenAI-compatible provider */
export const openAiModelInfoSaneDefaults: ModelInfo = {
	id: "",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: false,
		supportsReasoning: true,
		supportsTools: false,
		maxTokens: -1,
		contextWindow: 128_000,
	},
}

/** Default API version for Azure OpenAI */
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"
