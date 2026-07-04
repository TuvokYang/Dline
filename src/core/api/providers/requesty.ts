import { ModelInfo, requestyDefaultModelId, requestyDefaultModelInfo } from "@shared/api"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { toRequestyServiceStringUrl } from "@/shared/clients/requesty"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, ApiHandlerContext } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

// Requesty usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
interface RequestyUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

export class RequestyHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private ctx: ApiHandlerContext) {}

	private get config() {
		return this.ctx.profile.requesty
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
	private get thinkingBudgetTokens() {
		return this.config?.reasoning?.thinkingBudget ?? 0
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.apiKey) {
				throw new Error("Requesty API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: toRequestyServiceStringUrl(this.baseUrl),
					apiKey: this.apiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Requesty client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const reasoningEffort = this.reasoningEffort || "medium"
		const reasoning = { reasoning_effort: reasoningEffort }
		const reasoningArgs = model.id.startsWith("openai/o") ? reasoning : {}

		const thinkingBudget = this.thinkingBudgetTokens
		const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(model.id)
		const adaptiveThinking = isAdaptiveThinkingModel
			? resolveClaudeOpusAdaptiveThinking(this.reasoningEffort, thinkingBudget)
			: undefined
		const thinking =
			thinkingBudget > 0
				? { thinking: { type: "enabled", budget_tokens: thinkingBudget } }
				: { thinking: { type: "disabled" } }
		const supportsLegacyClaudeThinking =
			!isAdaptiveThinkingModel &&
			(model.id.includes("claude-3-7-sonnet") ||
				model.id.includes("claude-4.6-sonnet") ||
				model.id.includes("claude-sonnet-4") ||
				model.id.includes("claude-opus-4"))
		const thinkingArgs = isAdaptiveThinkingModel
			? adaptiveThinking?.enabled
				? {
						thinking: { type: "adaptive" },
						...(adaptiveThinking.effort ? { output_config: { effort: adaptiveThinking.effort } } : {}),
					}
				: {}
			: supportsLegacyClaudeThinking
				? thinking
				: {}

		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: model.info.capabilities?.maxTokens || undefined,
			messages: openAiMessages,
			...(isAdaptiveThinkingModel ? {} : { temperature: 0 }),
			stream: true,
			stream_options: { include_usage: true },
			...reasoningArgs,
			...thinkingArgs,
		})

		let lastUsage: any

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

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			const usage = lastUsage as RequestyUsage
			const inputTokens = usage.prompt_tokens || 0
			const outputTokens = usage.completion_tokens || 0
			const cacheWriteTokens = usage.prompt_tokens_details?.caching_tokens || undefined
			const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens || undefined
			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
				totalCost: totalCost,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.modelId
		const modelInfo = this.modelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: requestyDefaultModelId, info: requestyDefaultModelInfo }
	}
}
