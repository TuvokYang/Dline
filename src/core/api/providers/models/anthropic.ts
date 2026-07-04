/**
 * Anthropic provider model definitions.
 * Extracted from api.ts anthropicModels (lines 184-423).
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

export const anthropicModels: Record<string, ModelInfo> = {
	"claude-sonnet-4-6": {
		id: "claude-sonnet-4-6",
		name: "claude-sonnet-4-6",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	"claude-sonnet-4-6:1m": {
		id: "claude-sonnet-4-6:1m",
		name: "claude-sonnet-4-6:1m",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
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
	"claude-sonnet-4-5-20250929": {
		id: "claude-sonnet-4-5-20250929",
		name: "claude-sonnet-4-5-20250929",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	"claude-sonnet-4-5-20250929:1m": {
		id: "claude-sonnet-4-5-20250929:1m",
		name: "claude-sonnet-4-5-20250929:1m",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
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
	"claude-haiku-4-5-20251001": {
		id: "claude-haiku-4-5-20251001",
		name: "claude-haiku-4-5-20251001",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 1,
			outputPrice: 5.0,
			cacheWritesPrice: 1.25,
			cacheReadsPrice: 0.1,
		},
	},
	"claude-sonnet-4-20250514": {
		id: "claude-sonnet-4-20250514",
		name: "claude-sonnet-4-20250514",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	"claude-sonnet-4-20250514:1m": {
		id: "claude-sonnet-4-20250514:1m",
		name: "claude-sonnet-4-20250514:1m",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
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
	"claude-opus-4-6": {
		id: "claude-opus-4-6",
		name: "claude-opus-4-6",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	"claude-opus-4-6:fast": {
		id: "claude-opus-4-6:fast",
		name: "claude-opus-4-6:fast",
		description:
			"Anthropic fast mode preview for Claude Opus 4.6. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 30.0,
			outputPrice: 150.0,
			cacheWritesPrice: 37.5,
			cacheReadsPrice: 3.0,
		},
	},
	"claude-opus-4-6:1m": {
		id: "claude-opus-4-6:1m",
		name: "claude-opus-4-6:1m",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
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
	"claude-opus-4-6:1m:fast": {
		id: "claude-opus-4-6:1m:fast",
		name: "claude-opus-4-6:1m:fast",
		description:
			"Anthropic fast mode preview for Claude Opus 4.6 with the 1M context beta enabled. Same model and capabilities with higher output token speed at premium pricing across the full 1M context window. Requires both fast mode and 1M context access on your Anthropic account.",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 30.0,
			outputPrice: 150.0,
			cacheWritesPrice: 37.5,
			cacheReadsPrice: 3.0,
		},
	},
	"claude-opus-4-7": {
		id: "claude-opus-4-7",
		name: "claude-opus-4-7",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	"claude-opus-4-7:1m": {
		id: "claude-opus-4-7:1m",
		name: "claude-opus-4-7:1m",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
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
	"claude-opus-4-5-20251101": {
		id: "claude-opus-4-5-20251101",
		name: "claude-opus-4-5-20251101",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 5.0,
			outputPrice: 25.0,
			cacheWritesPrice: 6.25,
			cacheReadsPrice: 0.5,
		},
	},
	"claude-opus-4-1-20250805": {
		id: "claude-opus-4-1-20250805",
		name: "claude-opus-4-1-20250805",
		capabilities: {
			maxTokens: 32_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 15.0,
			outputPrice: 75.0,
			cacheWritesPrice: 18.75,
			cacheReadsPrice: 1.5,
		},
	},
	"claude-opus-4-20250514": {
		id: "claude-opus-4-20250514",
		name: "claude-opus-4-20250514",
		capabilities: {
			maxTokens: 32_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 15.0,
			outputPrice: 75.0,
			cacheWritesPrice: 18.75,
			cacheReadsPrice: 1.5,
		},
	},
	"claude-3-7-sonnet-20250219": {
		id: "claude-3-7-sonnet-20250219",
		name: "claude-3-7-sonnet-20250219",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	"claude-3-5-sonnet-20241022": {
		id: "claude-3-5-sonnet-20241022",
		name: "claude-3-5-sonnet-20241022",
		capabilities: {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		},
	},
	"claude-3-5-haiku-20241022": {
		id: "claude-3-5-haiku-20241022",
		name: "claude-3-5-haiku-20241022",
		capabilities: {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 0.8,
			outputPrice: 4.0,
			cacheWritesPrice: 1.0,
			cacheReadsPrice: 0.08,
		},
	},
	"claude-3-opus-20240229": {
		id: "claude-3-opus-20240229",
		name: "claude-3-opus-20240229",
		capabilities: {
			maxTokens: 4096,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 15.0,
			outputPrice: 75.0,
			cacheWritesPrice: 18.75,
			cacheReadsPrice: 1.5,
		},
	},
	"claude-3-haiku-20240307": {
		id: "claude-3-haiku-20240307",
		name: "claude-3-haiku-20240307",
		capabilities: {
			maxTokens: 4096,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
		},
		pricing: {
			inputPrice: 0.25,
			outputPrice: 1.25,
			cacheWritesPrice: 0.3,
			cacheReadsPrice: 0.03,
		},
	},
}
