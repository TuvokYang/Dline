import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity"
import { azureOpenAiDefaultApiVersion, ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient, fetch } from "@/shared/net"
import { ApiHandler, ApiHandlerContext } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

/**
 * Applies prompt cache control to messages at the content-block level.
 *
 * Many third-party OpenAI-compatible APIs (e.g., LiteLLM, OpenRouter with
 * Anthropic backends) support an Anthropic-style cache_control field.
 * Per the Anthropic protocol, cache_control must be placed on individual
 * content blocks, not at the message top-level.
 *
 * NOTE: Native OpenAI does NOT use cache_control — prompt caching is
 * automatic there. This function exists solely for third-party compatibility.
 *
 * @param messages - Chat completion messages to annotate (mutated in-place)
 * @param cacheControl - The cache_control annotation, or undefined to skip
 */
function applyCacheControlToMessages(
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	cacheControl: { cache_control: { type: "ephemeral" } } | undefined,
): void {
	if (!cacheControl) {
		return
	}

	// Attach cache_control to a single message at content-block level
	const attachToMessage = (msg: OpenAI.Chat.ChatCompletionMessageParam) => {
		if (typeof msg.content === "string") {
			// Wrap string content in an array so cache_control can live on the block
			msg.content = [{ type: "text", text: msg.content, ...cacheControl } as any]
		} else if (Array.isArray(msg.content)) {
			const lastIdx = msg.content.length - 1
			if (lastIdx >= 0) {
				msg.content[lastIdx] = { ...msg.content[lastIdx], ...cacheControl }
			}
		}
		// Messages without content (e.g. assistant with only tool_calls) are skipped
	}

	// Always cache the system/developer message (index 0)
	if (messages.length > 0) {
		const firstRole = messages[0].role
		if (firstRole === "system" || firstRole === "developer") {
			attachToMessage(messages[0])
		}
	}

	// Find the last two user messages for cache breakpoints.
	// Strategy: mark the latest user message as ephemeral so it can be cached
	// for the *next* request, and mark the second-to-last user message as
	// ephemeral to tell the server which message to retrieve from cache for
	// the *current* request.
	let lastUserIdx = -1
	let secondLastUserIdx = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			if (lastUserIdx === -1) {
				lastUserIdx = i
			} else {
				secondLastUserIdx = i
				break
			}
		}
	}

	if (lastUserIdx >= 0) {
		attachToMessage(messages[lastUserIdx])
	}
	if (secondLastUserIdx >= 0) {
		attachToMessage(messages[secondLastUserIdx])
	}
}

export class OpenAiHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private ctx: ApiHandlerContext) {}

	private get config() {
		return this.ctx.profile.openai
	}
	private get apiKey() {
		return this.ctx.profile.apiKey
	}
	private get modelId() {
		return this.ctx.profile.modelId || ""
	}
	private get modelInfo() {
		return this.ctx.profile.modelInfo as ModelInfo | undefined
	}
	private get baseUrl() {
		return this.ctx.profile.baseUrl
	}
	private get reasoningEffort() {
		return this.config?.reasoning?.effort
	}
	private get azureApiVersion() {
		return this.config?.azureApiVersion
	}
	private get azureIdentity() {
		return this.config?.azureIdentity
	}
	private get openAiHeaders() {
		return this.config?.openAiHeaders
	}

	private getAzureAudienceScope(baseUrl?: string): string {
		const url = baseUrl?.toLowerCase() ?? ""
		if (url.includes("azure.us")) return "https://cognitiveservices.azure.us/.default"
		if (url.includes("azure.com")) return "https://cognitiveservices.azure.com/.default"
		return "https://cognitiveservices.azure.com/.default"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.apiKey && !this.azureIdentity) {
				throw new Error("OpenAI API key or Azure Identity Authentication is required")
			}
			try {
				const baseUrl = (this.baseUrl ?? "").toLowerCase()
				const isAzureDomain = baseUrl.includes("azure.com") || baseUrl.includes("azure.us")
				const externalHeaders = buildExternalBasicHeaders()
				// Azure API shape slightly differs from the core API shape...
				if (this.azureApiVersion || (isAzureDomain && !this.modelId?.toLowerCase().includes("deepseek"))) {
					if (this.azureIdentity) {
						this.client = new AzureOpenAI({
							baseURL: this.baseUrl,
							azureADTokenProvider: getBearerTokenProvider(
								new DefaultAzureCredential(),
								this.getAzureAudienceScope(this.baseUrl),
							),
							apiVersion: this.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: {
								...externalHeaders,
								...this.openAiHeaders,
							},
							fetch,
						})
					} else {
						this.client = new AzureOpenAI({
							baseURL: this.baseUrl,
							apiKey: this.apiKey,
							apiVersion: this.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: {
								...externalHeaders,
								...this.openAiHeaders,
							},
							fetch,
						})
					}
				} else {
					this.client = createOpenAIClient({
						baseURL: this.baseUrl,
						apiKey: this.apiKey,
						defaultHeaders: this.openAiHeaders,
					})
				}
				// biome-ignore lint/suspicious/noExplicitAny: catch clause
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.modelId
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Determine cache_control annotation — applied later after all message
		// transformations are complete (see applyCacheControlToMessages below)
		const cacheControl = this.modelInfo?.capabilities?.supportsPromptCache
			? { cache_control: { type: "ephemeral" as const } }
			: undefined

		let temperature: number | undefined
		const configTemp = this.config?.temperature
		temperature = configTemp != null && configTemp !== 0 ? Number(configTemp) : undefined

		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (this.modelInfo?.capabilities?.maxTokens && this.modelInfo?.capabilities?.maxTokens > 0) {
			maxTokens = Number(this.modelInfo?.capabilities?.maxTokens)
		} else {
			maxTokens = undefined
		}

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const thinkingBudget = this.config?.reasoning?.thinkingBudget ?? 0
		if (thinkingBudget > 0) {
			// Budget mode: use enable_thinking + thinking_budget, no effort
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			reasoningEffort = undefined
		} else {
			// Effort mode: send reasoning_effort based on the config value, not model ID prefix
			const requestedEffort = normalizeOpenaiReasoningEffort(this.reasoningEffort)
			reasoningEffort = requestedEffort === "none" ? undefined : (requestedEffort as ChatCompletionReasoningEffort)
		}

		// o-series model-specific handling: developer role + no temperature
		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
		}

		// Apply prompt cache control AFTER all message transformations are complete.
		// This ensures cache_control is not lost when openAiMessages is reassigned
		// for deepseek-reasoner, thinking budget, or o-series model paths above.
		applyCacheControlToMessages(openAiMessages, cacheControl)

		const requestParams: any = {
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			stream: true,
			reasoning_effort: reasoningEffort,
		}
		// Enable thinking: budget mode uses explicit budget; effort mode uses reasoning_effort + enable_thinking
		if (thinkingBudget > 0) {
			requestParams.enable_thinking = true
			requestParams.thinking_budget = thinkingBudget
		} else if (reasoningEffort) {
			requestParams.enable_thinking = true
		}
		if (this.config?.streamIncludeUsage !== false) {
			requestParams.stream_options = { include_usage: true }
		}
		Object.assign(requestParams, getOpenAIToolParams(tools))

		const stream = await (client.chat.completions as any).create(requestParams)

		const toolCallProcessor = new ToolCallProcessor()

		let usageYielded = false

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage && !usageYielded) {
				usageYielded = true
				// Parse cache tokens from multiple possible field names
				// Different OpenAI-compatible providers use different field names
				const rawInputTokens = chunk.usage.prompt_tokens || 0
				const outputTokens = chunk.usage.completion_tokens || 0
				const cacheReadTokens =
					chunk.usage.cache_read_input_tokens ??
					chunk.usage.prompt_cache_hit_tokens ??
					chunk.usage.prompt_tokens_details?.cached_tokens ??
					0
				const cacheWriteTokens =
					chunk.usage.cache_creation_input_tokens ??
					chunk.usage.prompt_cache_miss_tokens ??
					chunk.usage.prompt_tokens_details?.cache_miss_tokens ??
					0
				const modelInfo = this.modelInfo ?? openAiModelInfoSaneDefaults
				// Yield inputTokens in Anthropic semantic (excluding cache) so
				// ContextManager and updateApiReqMsg can accurately estimate
				// context pressure. Cost calculation still uses OpenAI semantic
				// (rawInputTokens includes cache) for correct provider billing.
				const nonCachedInputTokens = Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens)
				const totalCost = calculateApiCostOpenAI(
					modelInfo,
					rawInputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
				)

				yield {
					type: "usage",
					inputTokens: nonCachedInputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
					totalCost,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.modelId,
			info: this.modelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
