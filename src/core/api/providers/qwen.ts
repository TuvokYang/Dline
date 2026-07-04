import {
	InternationalQwenModelId,
	internationalQwenDefaultModelId,
	internationalQwenModels,
	MainlandQwenModelId,
	ModelInfo,
	mainlandQwenDefaultModelId,
	mainlandQwenModels,
	QwenApiRegions,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, ApiHandlerContext } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

export class QwenHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private ctx: ApiHandlerContext) {}

	private get config() {
		return this.ctx.profile.qwen
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
	private get thinkingBudgetTokens() {
		return this.config?.reasoning?.thinkingBudget ?? 0
	}

	private useChinaApi(): boolean {
		return (this.config?.qwenApiLine ?? QwenApiRegions.CHINA) === QwenApiRegions.CHINA
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.apiKey) {
				throw new Error("Alibaba API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL:
						this.baseUrl ||
						(this.useChinaApi()
							? "https://dashscope.aliyuncs.com/compatible-mode/v1"
							: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
					apiKey: this.apiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Alibaba client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: MainlandQwenModelId | InternationalQwenModelId; info: ModelInfo } {
		const modelId = this.modelId
		// Branch based on API line to let poor typescript know what to do
		if (this.useChinaApi()) {
			const id = modelId && modelId in mainlandQwenModels ? (modelId as MainlandQwenModelId) : mainlandQwenDefaultModelId
			return {
				id,
				info: mainlandQwenModels[id],
			}
		}
		const id =
			modelId && modelId in internationalQwenModels
				? (modelId as InternationalQwenModelId)
				: internationalQwenDefaultModelId
		return {
			id,
			info: internationalQwenModels[id],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const isDeepseekReasoner = model.id.includes("deepseek-r1")
		const isReasoningModelFamily = model.id.includes("qwen3") || ["qwen-plus-latest", "qwen-turbo-latest"].includes(model.id)

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		let temperature: number | undefined = 0
		// Configuration for extended thinking
		const budgetTokens = this.thinkingBudgetTokens
		const reasoningOn = budgetTokens !== 0
		const thinkingArgs = isReasoningModelFamily
			? {
					enable_thinking: reasoningOn,
					thinking_budget: reasoningOn ? budgetTokens : undefined,
				}
			: undefined

		if (isDeepseekReasoner || (reasoningOn && isReasoningModelFamily)) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			temperature = undefined
		}

		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.capabilities?.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature,
			...thinkingArgs,
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				try {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				} catch (error) {
					Logger.error("Error processing tool call delta:", error, delta.tool_calls)
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-expect-error-next-line
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}
}
