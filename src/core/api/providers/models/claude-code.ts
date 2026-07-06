/**
 * Claude Code provider model definitions.
 * Extracted from api.ts claudeCodeModels (lines 428-526).
 * Each entry spreads an anthropicModels value with overrides — all spreads are inlined here.
 */
import type { ModelInfo } from "@shared/api"

// Inlined from api.ts: CLAUDE_SONNET_1M_TIERS
const CLAUDE_SONNET_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 3.0,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	{
		contextWindow: Number.MAX_SAFE_INTEGER,
		inputPrice: 6,
		outputPrice: 22.5,
		cacheWritesPrice: 7.5,
		cacheReadsPrice: 0.6,
	},
]

// Inlined from api.ts: CLAUDE_OPUS_1M_TIERS
const CLAUDE_OPUS_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 5.0,
		outputPrice: 25,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	{
		contextWindow: Number.MAX_SAFE_INTEGER,
		inputPrice: 10,
		outputPrice: 37.5,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
	},
]

export const claudeCodeModels: Record<string, ModelInfo> = {
	// sonnet → ...anthropicModels["claude-sonnet-4-5-20250929"]
	sonnet: {
		id: "sonnet",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	// sonnet[1m] → ...anthropicModels["claude-sonnet-4-5-20250929:1m"]
	"sonnet[1m]": {
		id: "sonnet[1m]",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
			tiers: CLAUDE_SONNET_1M_TIERS,
		},
	},
	// opus → ...anthropicModels["claude-opus-4-7"]
	opus: {
		id: "opus",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	// opus[1m] → ...anthropicModels["claude-opus-4-7:1m"]
	"opus[1m]": {
		id: "opus[1m]",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
			tiers: CLAUDE_OPUS_1M_TIERS,
		},
	},
	// claude-haiku-4-5-20251001 → ...anthropicModels["claude-haiku-4-5-20251001"]
	"claude-haiku-4-5-20251001": {
		id: "claude-haiku-4-5-20251001",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1,
			outputPrice: 5.0,
			cacheWritesPrice: 1.25,
			cacheReadsPrice: 0.1,
		},
	},
	// claude-sonnet-4-6 → ...anthropicModels["claude-sonnet-4-6"]
	"claude-sonnet-4-6": {
		id: "claude-sonnet-4-6",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	// claude-sonnet-4-6[1m] → ...anthropicModels["claude-sonnet-4-6:1m"]
	"claude-sonnet-4-6[1m]": {
		id: "claude-sonnet-4-6[1m]",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
			tiers: CLAUDE_SONNET_1M_TIERS,
		},
	},
	// claude-sonnet-4-5-20250929 → ...anthropicModels["claude-sonnet-4-5-20250929"]
	"claude-sonnet-4-5-20250929": {
		id: "claude-sonnet-4-5-20250929",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	// claude-sonnet-4-5-20250929[1m] → ...anthropicModels["claude-sonnet-4-5-20250929:1m"]
	"claude-sonnet-4-5-20250929[1m]": {
		id: "claude-sonnet-4-5-20250929[1m]",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
			tiers: CLAUDE_SONNET_1M_TIERS,
		},
	},
	// claude-sonnet-4-20250514 → ...anthropicModels["claude-sonnet-4-20250514"]
	"claude-sonnet-4-20250514": {
		id: "claude-sonnet-4-20250514",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	// claude-opus-4-6 → ...anthropicModels["claude-opus-4-6"]
	"claude-opus-4-6": {
		id: "claude-opus-4-6",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	// claude-opus-4-6[1m] → ...anthropicModels["claude-opus-4-6:1m"]
	"claude-opus-4-6[1m]": {
		id: "claude-opus-4-6[1m]",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
			tiers: CLAUDE_OPUS_1M_TIERS,
		},
	},
	// claude-opus-4-7 → ...anthropicModels["claude-opus-4-7"]
	"claude-opus-4-7": {
		id: "claude-opus-4-7",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	// claude-opus-4-7[1m] → ...anthropicModels["claude-opus-4-7:1m"]
	"claude-opus-4-7[1m]": {
		id: "claude-opus-4-7[1m]",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
			tiers: CLAUDE_OPUS_1M_TIERS,
		},
	},
	// claude-opus-4-5-20251101 → ...anthropicModels["claude-opus-4-5-20251101"]
	"claude-opus-4-5-20251101": {
		id: "claude-opus-4-5-20251101",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	// claude-opus-4-1-20250805 → ...anthropicModels["claude-opus-4-1-20250805"]
	"claude-opus-4-1-20250805": {
		id: "claude-opus-4-1-20250805",
		capabilities: {
			maxTokens: 32_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 15.0,
			outputPrice: 75.0,
			cacheWritesPrice: 18.75,
			cacheReadsPrice: 1.5,
		},
	},
	// claude-opus-4-20250514 → ...anthropicModels["claude-opus-4-20250514"]
	"claude-opus-4-20250514": {
		id: "claude-opus-4-20250514",
		capabilities: {
			maxTokens: 32_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 15.0,
			outputPrice: 75.0,
			cacheWritesPrice: 18.75,
			cacheReadsPrice: 1.5,
		},
	},
	// claude-3-7-sonnet-20250219 → ...anthropicModels["claude-3-7-sonnet-20250219"]
	"claude-3-7-sonnet-20250219": {
		id: "claude-3-7-sonnet-20250219",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	// claude-3-5-haiku-20241022 → ...anthropicModels["claude-3-5-haiku-20241022"]
	"claude-3-5-haiku-20241022": {
		id: "claude-3-5-haiku-20241022",
		capabilities: {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: false,
		},
		pricing: {
			inputPrice: 0.8,
			outputPrice: 4.0,
			cacheWritesPrice: 1.0,
			cacheReadsPrice: 0.08,
		},
	},
}

/** Default model ID for Claude Code provider */
export const claudeCodeDefaultModelId = "claude-sonnet-4-5-20250929"
