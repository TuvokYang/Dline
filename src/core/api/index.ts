import { findEnabledProfileByName } from "@core/controller/file/getApiProfiles"
import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { ApiConfiguration, ModelInfo } from "@shared/api"
import type { AccountUsageData, AccountUsageQuotaData } from "@shared/ExtensionMessage"
import type { ModelInfo as ProtoModelInfo } from "@shared/proto/dline/models"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { Mode } from "@shared/storage/types"
import { ClineError } from "@/services/error"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { AIhubmixHandler } from "./providers/aihubmix"
import { AnthropicHandler } from "./providers/anthropic"
import { AskSageHandler } from "./providers/asksage"
import { BasetenHandler } from "./providers/baseten"
import { AwsBedrockHandler } from "./providers/bedrock"
import { CerebrasHandler } from "./providers/cerebras"
import { ClaudeCodeHandler } from "./providers/claude-code"
import { ClineHandler } from "./providers/cline"
import { DeepSeekHandler } from "./providers/deepseek"
import { DifyHandler } from "./providers/dify"
import { DoubaoHandler } from "./providers/doubao"
import { FireworksHandler } from "./providers/fireworks"
import { GeminiHandler } from "./providers/gemini"
import { GroqHandler } from "./providers/groq"
import { HicapHandler } from "./providers/hicap"
import { HuaweiCloudMaaSHandler } from "./providers/huawei-cloud-maas"
import { HuggingFaceHandler } from "./providers/huggingface"
import { LiteLlmHandler } from "./providers/litellm"
import { LmStudioHandler } from "./providers/lmstudio"
import { MinimaxHandler } from "./providers/minimax"
import { MistralHandler } from "./providers/mistral"
import { MoonshotHandler } from "./providers/moonshot"
import { NebiusHandler } from "./providers/nebius"
import { NousResearchHandler } from "./providers/nousresearch"
import { OcaHandler } from "./providers/oca"
import { OllamaHandler } from "./providers/ollama"
import { OpenAiHandler } from "./providers/openai"
import { OpenAiCodexHandler } from "./providers/openai-codex"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { OpenRouterHandler } from "./providers/openrouter"
import { QwenHandler } from "./providers/qwen"
import { QwenCodeHandler } from "./providers/qwen-code"
import { RequestyHandler } from "./providers/requesty"
import { SambanovaHandler } from "./providers/sambanova"
import { SapAiCoreHandler } from "./providers/sapaicore"
import { TogetherHandler } from "./providers/together"
import { VercelAIGatewayHandler } from "./providers/vercel-ai-gateway"
import { VertexHandler } from "./providers/vertex"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { WandbHandler } from "./providers/wandb"
import { XAIHandler } from "./providers/xai"
import { ZAiHandler } from "./providers/zai"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

/** @deprecated Use ApiHandlerContext instead */
export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}

/**
 * Context passed to every API handler. Contains the full ApiProfile
 * so handlers can read model capabilities from profile.modelInfo and
 * runtime reasoning config from profile.[provider].reasoning directly.
 */
export interface ApiHandlerContext {
	profile: ApiProfile
	mode: Mode
	ulid?: string
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void
	requestTimeoutMs?: number
	enableParallelToolCalling?: boolean
}

/**
 * Re-export shared types for account usage.
 * Single source of truth: @shared/ExtensionMessage.
 */
export type UsageQuota = AccountUsageQuotaData
export type AccountUsage = AccountUsageData

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[], useResponseApi?: boolean): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	/** Query account-level usage/balance from the provider. Returns undefined if not supported. */
	getAccountUsage?(): Promise<AccountUsage | undefined>
	abort?(): void
	/** Parse a provider-specific error into a ClineError. Falls back to generic ClineError.transform if not implemented. */
	parseError?(error: any, modelId?: string): ClineError
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

/** @deprecated Replaced by ApiHandlerContext — handlers now read directly from ctx.profile */
interface ProfileResolved {
	apiKey?: string
	baseUrl?: string
	modelId?: string
	modelInfo?: ModelInfo
	provider: string
	providerConfig: unknown
}

function fromProfileModelInfo(modelInfo?: ProtoModelInfo): ModelInfo | undefined {
	const capabilities = modelInfo?.capabilities
	if (!modelInfo || !capabilities) return undefined

	return {
		id: modelInfo.id,
		name: modelInfo.name,
		description: modelInfo.description,
		capabilities: {
			supportsImages: capabilities.supportsImages,
			supportsPromptCache: capabilities.supportsPromptCache,
			supportsReasoning: capabilities.supportsReasoning,
			supportsGlobalEndpoint: capabilities.supportsGlobalEndpoint,
			maxTokens: capabilities.maxTokens,
			contextWindow: capabilities.contextWindow,
			thinking: capabilities.thinking ? { ...capabilities.thinking } : undefined,
		},
		pricing: modelInfo.pricing
			? {
					inputPrice: modelInfo.pricing.inputPrice,
					outputPrice: modelInfo.pricing.outputPrice,
					cacheWritesPrice: modelInfo.pricing.cacheWritesPrice,
					cacheReadsPrice: modelInfo.pricing.cacheReadsPrice,
					currency: modelInfo.pricing.currency,
					tiers:
						(modelInfo.pricing.tiers?.length ?? 0) > 0
							? modelInfo.pricing.tiers!.map((tier) => ({ ...tier }))
							: undefined,
					thinkingOutputPrice: modelInfo.pricing?.thinkingOutputPrice,
					thinkingOutputPriceTiers:
						(modelInfo.pricing.thinkingOutputPriceTiers?.length ?? 0) > 0
							? modelInfo.pricing.thinkingOutputPriceTiers!.map((tier) => ({ ...tier }))
							: undefined,
				}
			: undefined,
	}
}

/**
 * Pure dispatch — each handler receives the full ApiHandlerContext and reads
 * what it needs directly from ctx.profile.[provider] and ctx.profile.modelInfo.
 */
function createHandlerForProvider(ctx: ApiHandlerContext): ApiHandler {
	const { profile } = ctx

	switch (profile.provider) {
		case "anthropic":
			return new AnthropicHandler(ctx)
		case "openrouter":
			return new OpenRouterHandler(ctx)
		case "bedrock":
			return new AwsBedrockHandler(ctx)
		case "vertex":
			return new VertexHandler(ctx)
		case "openai":
			return new OpenAiHandler(ctx)
		case "ollama":
			return new OllamaHandler(ctx)
		case "lmstudio":
			return new LmStudioHandler(ctx)
		case "gemini":
			return new GeminiHandler(ctx)
		case "openai-native":
			return new OpenAiNativeHandler(ctx)
		case "openai-codex":
			return new OpenAiCodexHandler(ctx)
		case "deepseek":
			return new DeepSeekHandler(ctx)
		case "requesty":
			return new RequestyHandler(ctx)
		case "fireworks":
			return new FireworksHandler(ctx)
		case "together":
			return new TogetherHandler(ctx)
		case "qwen":
			return new QwenHandler(ctx)
		case "qwen-code":
			return new QwenCodeHandler(ctx)
		case "doubao":
			return new DoubaoHandler(ctx)
		case "mistral":
			return new MistralHandler(ctx)
		case "vscode-lm":
			return new VsCodeLmHandler(ctx)
		case "cline":
			return new ClineHandler(ctx)
		case "litellm":
			return new LiteLlmHandler(ctx)
		case "moonshot":
			return new MoonshotHandler(ctx)
		case "nebius":
			return new NebiusHandler(ctx)
		case "asksage":
			return new AskSageHandler(ctx)
		case "xai":
			return new XAIHandler(ctx)
		case "sambanova":
			return new SambanovaHandler(ctx)
		case "cerebras":
			return new CerebrasHandler(ctx)
		case "groq":
			return new GroqHandler(ctx)
		case "sapaicore":
			return new SapAiCoreHandler(ctx)
		case "baseten":
			return new BasetenHandler(ctx)
		case "huggingface":
			return new HuggingFaceHandler(ctx)
		case "huawei-cloud-maas":
			return new HuaweiCloudMaaSHandler(ctx)
		case "claude-code":
			return new ClaudeCodeHandler(ctx)
		case "dify":
			return new DifyHandler(ctx)
		case "vercel-ai-gateway":
			return new VercelAIGatewayHandler(ctx)
		case "zai":
			return new ZAiHandler(ctx)
		case "oca":
			return new OcaHandler(ctx)
		case "aihubmix":
			return new AIhubmixHandler(ctx)
		case "minimax":
			return new MinimaxHandler(ctx)
		case "hicap":
			return new HicapHandler(ctx)
		case "nousResearch":
			return new NousResearchHandler(ctx)
		case "wandb":
			return new WandbHandler(ctx)
		default:
			throw new Error(`Unknown provider: ${profile.provider}`)
	}
}

/** @deprecated Each handler now reads its own provider config via ctx.profile.[provider] */
function getProviderConfig(profile: ApiProfile): unknown | undefined {
	switch (profile.provider) {
		case "anthropic":
			return profile.anthropic
		case "bedrock":
			return profile.bedrock
		case "vertex":
			return profile.vertex
		case "sapaicore":
			return profile.sapaicore
		case "claude-code":
			return profile.claudeCode
		case "openrouter":
			return profile.openrouter
		case "openai":
			return profile.openai
		case "ollama":
			return profile.ollama
		case "lmstudio":
			return profile.lmstudio
		case "qwen":
			return profile.qwen
		case "qwen-code":
			return profile.qwenCode
		case "litellm":
			return profile.litellm
		case "moonshot":
			return profile.moonshot
		case "asksage":
			return profile.asksage
		case "cline":
			return profile.clineProvider
		case "zai":
			return profile.zai
		case "oca":
			return profile.oca
		case "aihubmix":
			return profile.aihubmix
		case "minimax":
			return profile.minimax
		case "deepseek":
			return profile.deepseek
		case "doubao":
			return profile.doubao
		case "mistral":
			return profile.mistral
		case "vscode-lm":
			return profile.vscodeLm
		case "nebius":
			return profile.nebius
		case "fireworks":
			return profile.fireworks
		case "xai":
			return profile.xai
		case "sambanova":
			return profile.sambanova
		case "cerebras":
			return profile.cerebras
		case "groq":
			return profile.groq
		case "huggingface":
			return profile.huggingface
		case "huawei-cloud-maas":
			return profile.huaweiCloudMaas
		case "baseten":
			return profile.baseten
		case "vercel-ai-gateway":
			return profile.vercelAiGateway
		case "together":
			return profile.together
		case "requesty":
			return profile.requesty
		case "hicap":
			return profile.hicap
		case "openai-codex":
			return profile.openaiCodex
		case "openai-native":
			return profile.openaiNative
		case "gemini":
			return profile.gemini
		case "nousResearch":
			return profile.nousResearch
		case "wandb":
			return profile.wandb
		case "dify":
			return profile.dify
		default:
			return undefined
	}
}

/** @deprecated Handler now reads directly from ctx.profile */
function resolveProfile(profileName: string): ProfileResolved | undefined {
	const profile = findEnabledProfileByName(profileName)
	if (!profile) return undefined
	const registry = ModelRegistry.getInstance()
	const pInfo = registry.getProviderModels(profile.provider)
	const apiKey = profile.apiKey
	const baseUrl = profile.baseUrl ?? pInfo?.baseUrl
	const modelId = profile.modelId
	const modelInfo =
		fromProfileModelInfo(profile.modelInfo) ?? (modelId ? (pInfo?.models[modelId] as ModelInfo | undefined) : undefined)
	const providerConfig = getProviderConfig(profile)
	return { apiKey, baseUrl, modelId, modelInfo, provider: profile.provider, providerConfig }
}

export function resolveProviderFromProfile(profileName?: string): string | undefined {
	if (!profileName) return undefined
	const profile = findEnabledProfileByName(profileName)
	return profile?.provider
}

export function resolveProvider(config: ApiConfiguration, mode: Mode): string | undefined {
	const profileName = mode === "plan" ? config.planModeProfile : config.actModeProfile
	if (!profileName) return undefined
	const profile = findEnabledProfileByName(profileName)
	return profile?.provider
}

/**
 * Build an API handler for the given mode from the configured profile.
 * Looks up the profile by name from api_profiles.json and passes the full
 * ApiProfile into the handler via ApiHandlerContext.
 */
export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const profileName = mode === "plan" ? configuration.planModeProfile : configuration.actModeProfile
	if (!profileName) {
		throw new Error(`No profile configured for ${mode} mode`)
	}
	const profile = findEnabledProfileByName(profileName)
	if (!profile) {
		throw new Error(`Profile "${profileName}" not found`)
	}
	return createHandlerForProvider({
		profile,
		mode,
		ulid: configuration.ulid,
		onRetryAttempt: configuration.onRetryAttempt,
		requestTimeoutMs: configuration.requestTimeoutMs,
		enableParallelToolCalling: configuration.enableParallelToolCalling,
	})
}
