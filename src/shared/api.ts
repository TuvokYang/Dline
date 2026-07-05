import { vertexModels } from "../core/api/providers/models/vertex"
import type { ModelInfo } from "./providers/types"

export type ApiProvider =
	| "anthropic"
	| "claude-code"
	| "openrouter"
	| "bedrock"
	| "vertex"
	| "openai"
	| "ollama"
	| "lmstudio"
	| "gemini"
	| "openai-native"
	| "openai-codex"
	| "requesty"
	| "together"
	| "deepseek"
	| "qwen"
	| "qwen-code"
	| "doubao"
	| "mistral"
	| "vscode-lm"
	| "cline"
	| "litellm"
	| "moonshot"
	| "nebius"
	| "fireworks"
	| "asksage"
	| "xai"
	| "sambanova"
	| "cerebras"
	| "sapaicore"
	| "groq"
	| "huggingface"
	| "huawei-cloud-maas"
	| "dify"
	| "baseten"
	| "vercel-ai-gateway"
	| "zai"
	| "oca"
	| "aihubmix"
	| "minimax"
	| "hicap"
	| "nousResearch"
	| "wandb"

export const DEFAULT_API_PROVIDER = "openrouter" as ApiProvider

/**
 * Provider+model configuration driven by ApiProfile.
 * All provider-specific fields (apiKey, baseUrl, modelId, modelInfo, etc.)
 * are now sourced from ApiProfile + ModelRegistry at runtime.
 */
export interface ApiConfiguration {
	/** Profile name for plan mode */
	planModeProfile?: string
	/** Profile name for act mode */
	actModeProfile?: string
	/** Task identifier */
	ulid?: string
	/** Retry callback */
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void
	/** Global request timeout (ms) */
	requestTimeoutMs?: number
	/** Whether parallel tool calling is enabled */
	enableParallelToolCalling?: boolean
}

/**
 * @deprecated Legacy flat-field config, replaced by ApiConfiguration.
 * Kept for gradual migration — will be removed.
 */
export interface ApiHandlerOptions extends ApiConfiguration {
	[key: string]: any
}

// ModelInfo type re-exported from proto/dline/models (canonical source)
export type { ModelInfo } from "./proto/dline/models"
export type { ModelCapabilities, ModelPricing, ThinkingConfig } from "./proto/dline/models/metadata"

export interface OcaModelInfo extends ModelInfo {
	modelName: string
	surveyId?: string
	banner?: string
	surveyContent?: string
	supportsReasoning?: boolean
	reasoningEffortOptions: string[]
}

export const CLAUDE_SONNET_1M_SUFFIX = ":1m"
export const ANTHROPIC_FAST_MODE_SUFFIX = ":fast"
export const CLAUDE_SONNET_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 3.0,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	{
		contextWindow: Number.MAX_SAFE_INTEGER, // storing infinity in vs storage is not possible, it converts to 'null', which causes crash in webview ModelInfoView
		inputPrice: 6,
		outputPrice: 22.5,
		cacheWritesPrice: 7.5,
		cacheReadsPrice: 0.6,
	},
]
export const CLAUDE_OPUS_1M_TIERS = [
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

export interface HicapCompatibleModelInfo extends ModelInfo {
	temperature?: number
}

export const hicapModelInfoSaneDefaults: HicapCompatibleModelInfo = {
	id: "",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: false,
		maxTokens: -1,
		contextWindow: 128_000,
	},
	pricing: {
		inputPrice: 0,
		outputPrice: 0,
	},
	temperature: 1,
}

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

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models // prices updated 2025-01-02
export type AnthropicModelId = string
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-4-5-20250929"
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000

// Type aliases for all provider model IDs (all string types since models are now ModelInfo[] arrays)
export type ClaudeCodeModelId = string
export type BedrockModelId = string
export type VertexModelId = string
export type GeminiModelId = string
export type OpenAiNativeModelId = string
export type OpenAiCodexModelId = string
export type DeepSeekModelId = string
export type HuggingFaceModelId = string
export type InternationalQwenModelId = string
export type MainlandQwenModelId = string
export type DoubaoModelId = string
export type MistralModelId = string
export type AskSageModelId = string
export type NebiusModelId = string
export type WandbModelId = string
export type XAIModelId = string
export type SambanovaModelId = string
export type CerebrasModelId = string
export type GroqModelId = string
export type SapAiCoreModelId = string
export type MoonshotModelId = string
export type HuaweiCloudMaasModelId = string
export type BasetenModelId = string
export type internationalZAiModelId = string
export type mainlandZAiModelId = string
export type FireworksModelId = string
export type QwenCodeModelId = string
export type MinimaxModelId = string
export type NousResearchModelId = string

// Default model ID constants for all providers
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-5-20250929"
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-4-5-20250929-v1:0"
export const vertexDefaultModelId: VertexModelId = "gemini-3-pro-preview"
export const geminiDefaultModelId: GeminiModelId = "gemini-3.1-pro-preview"
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-5.5"
export const openAiCodexDefaultModelId: OpenAiCodexModelId = "gpt-5.3-codex"
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-v4-flash"
export const huggingFaceDefaultModelId: HuggingFaceModelId = "moonshotai/Kimi-K2-Instruct"
export const internationalQwenDefaultModelId: InternationalQwenModelId = "qwen3-coder-plus"
export const mainlandQwenDefaultModelId: MainlandQwenModelId = "qwen3-coder-plus"
export const doubaoDefaultModelId: DoubaoModelId = "doubao-1-5-pro-256k-250115"
export const mistralDefaultModelId: MistralModelId = "devstral-2512"
export const askSageDefaultModelId: AskSageModelId = "claude-4-sonnet"
export const askSageDefaultURL: string = "https://api.asksage.ai/server"
export const nebiusDefaultModelId = "Qwen/Qwen2.5-32B-Instruct-fast"
export const wandbDefaultModelId = "meta-llama/Llama-3.3-70B-Instruct"
export const xaiDefaultModelId: XAIModelId = "grok-4"
export const sambanovaDefaultModelId: SambanovaModelId = "Meta-Llama-3.3-70B-Instruct"
export const cerebrasDefaultModelId: CerebrasModelId = "zai-glm-4.7"
export const groqDefaultModelId: GroqModelId = "moonshotai/kimi-k2-instruct-0905"
export const sapAiCoreDefaultModelId: SapAiCoreModelId = "anthropic--claude-3.5-sonnet"
export const moonshotDefaultModelId = "kimi-k2-0905-preview"
export const huaweiCloudMaasDefaultModelId: HuaweiCloudMaasModelId = "DeepSeek-V3"
export const basetenDefaultModelId = "zai-org/GLM-4.6"
export const internationalZAiDefaultModelId: internationalZAiModelId = "glm-5.1"
export const mainlandZAiDefaultModelId: mainlandZAiModelId = "glm-5.1"
export const fireworksDefaultModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2p5"
export const qwenCodeDefaultModelId: QwenCodeModelId = "qwen3-coder-plus"
export const minimaxDefaultModelId: MinimaxModelId = "MiniMax-M2.7"
export const nousResearchDefaultModelId: NousResearchModelId = "Hermes-4-405B"

// OpenRouter
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4.5"
export const openRouterDefaultModelInfo: ModelInfo = {
	id: "",
	description: "Claude Sonnet 4.5 delivers superior intelligence across coding, agentic search, and AI agent capabilities.",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
		maxTokens: 64_000,
		contextWindow: 200_000,
	},
	pricing: {
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
}
export const openRouterClaudeSonnet41mModelId = `anthropic/claude-sonnet-4${CLAUDE_SONNET_1M_SUFFIX}`
export const openRouterClaudeSonnet451mModelId = `anthropic/claude-sonnet-4.5${CLAUDE_SONNET_1M_SUFFIX}`
export const openRouterClaudeSonnet461mModelId = `anthropic/claude-sonnet-4.6${CLAUDE_SONNET_1M_SUFFIX}`
export const openRouterClaudeOpus461mModelId = `anthropic/claude-opus-4.6${CLAUDE_SONNET_1M_SUFFIX}`
export const openRouterClaudeOpus471mModelId = `anthropic/claude-opus-4.7${CLAUDE_SONNET_1M_SUFFIX}`

// LiteLLM
export interface LiteLLMModelInfo extends ModelInfo {
	temperature?: number
}
export const liteLlmModelInfoSaneDefaults: LiteLLMModelInfo = {
	id: "",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: false,
		maxTokens: -1,
		contextWindow: 128_000,
	},
	pricing: {
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
	temperature: 0,
}
export const liteLlmDefaultModelId = "anthropic/claude-3-7-sonnet-20250219"

// OpenAI compatible defaults
export const openAiModelInfoSaneDefaults: ModelInfo = {
	id: "",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: false,
		supportsReasoning: false,
		maxTokens: -1,
		contextWindow: 128_000,
	},
}

// Azure
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"

// Qwen
export enum QwenApiRegions {
	CHINA = "china",
	INTERNATIONAL = "international",
}

// Requesty
export const requestyDefaultModelId = "anthropic/claude-3-7-sonnet-latest"
export const requestyDefaultModelInfo: ModelInfo = {
	id: "",
	capabilities: {
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: false,
		maxTokens: 64_000,
		contextWindow: 200_000,
	},
	pricing: {
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
}

// Vertex global models (filtered from vertexModels for models with global endpoint support)
export const vertexGlobalModels: Record<string, ModelInfo> = Object.fromEntries(
	Object.entries(vertexModels)
		.filter(([, model]) => model.capabilities?.supportsGlobalEndpoint)
		.map(([id, model]) => [id, model as ModelInfo]),
)

// OpenRouter provider preferences
export const OPENROUTER_PROVIDER_PREFERENCES: Record<string, { order: string[]; allow_fallbacks: boolean }> = {}

// Model data re-exports (canonical source: src/shared/providers/models/)
export { anthropicModels } from "../core/api/providers/models/anthropic"
export { askSageModels } from "../core/api/providers/models/asksage"
export { basetenModels } from "../core/api/providers/models/baseten"
export { bedrockModels } from "../core/api/providers/models/bedrock"
export { cerebrasModels } from "../core/api/providers/models/cerebras"
export { claudeCodeModels } from "../core/api/providers/models/claude-code"
export { deepSeekModels } from "../core/api/providers/models/deepseek"
export { doubaoModels } from "../core/api/providers/models/doubao"
export { fireworksModels } from "../core/api/providers/models/fireworks"
export { geminiModels } from "../core/api/providers/models/gemini"
export { groqModels } from "../core/api/providers/models/groq"
export { huaweiCloudMaasModels } from "../core/api/providers/models/huawei-cloud-maas"
export { huggingFaceModels } from "../core/api/providers/models/huggingface"
export { minimaxModels } from "../core/api/providers/models/minimax"
export { mistralModels } from "../core/api/providers/models/mistral"
export { moonshotModels } from "../core/api/providers/models/moonshot"
export { nebiusModels } from "../core/api/providers/models/nebius"
export { nousResearchModels } from "../core/api/providers/models/nousresearch"
export { openAiCodexModels } from "../core/api/providers/models/openai-codex"
export { openAiNativeModels } from "../core/api/providers/models/openai-native"
export { mainlandQwenModels } from "../core/api/providers/models/qwen-cn"
export { qwenCodeModels } from "../core/api/providers/models/qwen-code"
export { internationalQwenModels } from "../core/api/providers/models/qwen-intl"
export { sambanovaModels } from "../core/api/providers/models/sambanova"
export { sapAiCoreModels } from "../core/api/providers/models/sapaicore"
export { wandbModels } from "../core/api/providers/models/wandb"
export { xaiModels } from "../core/api/providers/models/xai"
export { mainlandZAiModels } from "../core/api/providers/models/zai-cn"
export { internationalZAiModels } from "../core/api/providers/models/zai-intl"
export { vertexModels }
