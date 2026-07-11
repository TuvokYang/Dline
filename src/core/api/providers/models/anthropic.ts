/**
 * Anthropic provider model definitions.
 * Extracted from api.ts anthropicModels (lines 184-423).
 */
import type { ModelInfo } from "@shared/api"

// Tiers used for building 1M variant model pricing (also used by refresh scripts)
export const CLAUDE_SONNET_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 3.0,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	{
		contextWindow: 1_000_000,
		inputPrice: 6,
		outputPrice: 22.5,
		cacheWritesPrice: 7.5,
		cacheReadsPrice: 0.6,
	},
]

// Used by refresh scripts to build 1M variant pricing
export const CLAUDE_OPUS_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 5.0,
		outputPrice: 25,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	{
		contextWindow: 1_000_000,
		inputPrice: 10,
		outputPrice: 37.5,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
	},
]

// Fable 5 1M context tiers
const CLAUDE_FABLE_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 10.0,
		outputPrice: 50,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
	},
	{
		contextWindow: 1_000_000,
		inputPrice: 20,
		outputPrice: 75,
		cacheWritesPrice: 25,
		cacheReadsPrice: 2.0,
	},
]

export const anthropicModels: Record<string, ModelInfo> = {
	"claude-fable-5": {
		id: "claude-fable-5",
		name: "claude-fable-5",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
		},
		pricing: {
			inputPrice: 10.0,
			outputPrice: 50.0,
			cacheWritesPrice: 12.5,
			cacheReadsPrice: 1.0,
			tiers: CLAUDE_FABLE_1M_TIERS,
		},
	},
	"claude-opus-4-8": {
		id: "claude-opus-4-8",
		name: "claude-opus-4-8",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
	"claude-sonnet-5": {
		id: "claude-sonnet-5",
		name: "claude-sonnet-5",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
	"claude-sonnet-4-6": {
		id: "claude-sonnet-4-6",
		name: "claude-sonnet-4-6",
		capabilities: {
			maxTokens: 64_000,
			contextWindow: 200_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
	"claude-opus-4-6:fast": {
		id: "claude-opus-4-6:fast",
		name: "claude-opus-4-6:fast",
		description:
			"Anthropic fast mode preview for Claude Opus 4.6. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
		capabilities: {
			maxTokens: 128_000,
			contextWindow: 200_000,
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
			contextWindowTiers: [
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			],
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
}

// Anthropic model suffix and capability constants
export const CLAUDE_SONNET_1M_SUFFIX = ":1m"
export const ANTHROPIC_FAST_MODE_SUFFIX = ":fast"
export const anthropicDefaultModelId = "claude-opus-4-8"
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000

/** Default ModelInfo for Anthropic custom model configuration */
export const anthropicModelInfoSaneDefaults: ModelInfo = {
	id: "",
	capabilities: {
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoning: true,
		maxTokens: 384000,
		contextWindow: 1_000_000,
		thinking: {
			supported: true,
			mode: "budget",
			maxBudget: 64000,
			effortLevels: [],
		},
	},
	pricing: {
		inputPrice: 1,
		outputPrice: 2,
		cacheWritesPrice: 0.2,
		cacheReadsPrice: 0.2,
	},
}
