import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
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
		return this.ctx.profile.modelInfo as OpenAiCompatibleModelInfo | undefined
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
		const isR1FormatRequired = this.modelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Apply prompt cache control if model supports it
		const cacheControl = this.modelInfo?.capabilities?.supportsPromptCache
			? { cache_control: { type: "ephemeral" as const } }
			: undefined

		if (cacheControl) {
			// Attach cache_control to system message (index 0)
			openAiMessages[0] = { ...openAiMessages[0], ...cacheControl }

			// Find the last two user messages for cache breakpoints
			let lastUserIdx = -1
			let secondLastUserIdx = -1
			for (let i = openAiMessages.length - 1; i >= 0; i--) {
				if (openAiMessages[i].role === "user") {
					if (lastUserIdx === -1) {
						lastUserIdx = i
					} else {
						secondLastUserIdx = i
						break
					}
				}
			}

			// Attach cache_control to the last two user messages
			if (lastUserIdx >= 0) {
				openAiMessages[lastUserIdx] = { ...openAiMessages[lastUserIdx], ...cacheControl }
			}
			if (secondLastUserIdx >= 0) {
				openAiMessages[secondLastUserIdx] = { ...openAiMessages[secondLastUserIdx], ...cacheControl }
			}
		}

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

		if (isDeepseekReasoner || isR1FormatRequired) {
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
				const inputTokens = chunk.usage.prompt_tokens || 0
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
				const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
				const modelInfo = this.modelInfo ?? openAiModelInfoSaneDefaults
				const totalCost = calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

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
