import { Anthropic } from "@anthropic-ai/sdk"
import type {
	MessageCreateParamsStreaming as BetaMessageCreateParamsStreaming,
	BetaRawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages"
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import type { MessageCreateParamsStreaming as AnthropicMessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages/messages"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { ANTHROPIC_FAST_MODE_SUFFIX, AnthropicModelId, anthropicDefaultModelId, anthropicModels, ModelInfo } from "@shared/api"
import { buildEffectiveModelInfo, selectContextTier } from "@shared/providers/effective-model-info"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, ApiHandlerContext } from "../index"
import { withRetry } from "../retry"
import { sanitizeAnthropicMessages } from "../transform/anthropic-format"
import { ApiStream } from "../transform/stream"

export const ANTHROPIC_FAST_MODE_BETA = "fast-mode-2026-02-01"

export class AnthropicHandler implements ApiHandler {
	private client: Anthropic | undefined

	constructor(private ctx: ApiHandlerContext) {}

	private get config() {
		return this.ctx.profile.anthropic
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

	/**
	 * Build model metadata for custom Anthropic-compatible models.
	 *
	 * @param modelId Custom model identifier configured by the user.
	 * @returns ModelInfo using profile overrides, provider custom config, or sane defaults.
	 */
	private buildCustomModelInfo(modelId: string): ModelInfo {
		return buildEffectiveModelInfo(modelId, undefined, {
			capabilities: this.config?.capabilities,
			pricing: this.config?.pricing,
			enableLongContext: this.config?.enableLongContext,
			pricingTiersEnabled: this.config?.pricingTiersEnabled,
		})
	}

	/**
	 * Build effective Anthropic registry model metadata with provider overrides.
	 *
	 * @param modelId Selected registry model identifier.
	 * @returns Effective model metadata for display and request handling.
	 */
	private buildRegistryModelInfo(modelId: string): ModelInfo {
		return buildEffectiveModelInfo(modelId, anthropicModels[modelId], {
			capabilities: this.config?.capabilities,
			pricing: this.config?.pricing,
			enableLongContext: this.config?.enableLongContext,
			pricingTiersEnabled: this.config?.pricingTiersEnabled,
		})
	}

	/**
	 * Resolve the model identifier sent to the Anthropic API.
	 *
	 * @param modelId Base registry or custom model identifier.
	 * @param modelInfo Effective metadata containing selectable context tiers.
	 * @returns API model identifier with the selected tier suffix applied.
	 */
	private resolveApiModelId(modelId: AnthropicModelId, modelInfo: ModelInfo): string {
		const baseModelId = modelId.endsWith(ANTHROPIC_FAST_MODE_SUFFIX)
			? modelId.slice(0, -ANTHROPIC_FAST_MODE_SUFFIX.length)
			: modelId
		const tier = selectContextTier(modelInfo.capabilities, this.config?.enableLongContext)
		return `${baseModelId}${tier?.apiModelSuffix ?? ""}`
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.apiKey) {
				throw new Error("Anthropic API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.apiKey,
					baseURL: this.baseUrl || undefined,
					defaultHeaders: buildExternalBasicHeaders(),
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: AnthropicTool[]): ApiStream {
		const client = this.ensureClient()

		const model = this.getModel()
		let stream: AnthropicStream<Anthropic.RawMessageStreamEvent> | AsyncIterable<BetaRawMessageStreamEvent>

		const useFastMode = model.id.endsWith(ANTHROPIC_FAST_MODE_SUFFIX)
		const modelId = useFastMode ? model.id.slice(0, -ANTHROPIC_FAST_MODE_SUFFIX.length) : model.id
		const selectedTier = selectContextTier(model.info.capabilities, this.config?.enableLongContext)
		const apiModelId = this.resolveApiModelId(model.id, model.info)
		const enable1mContextWindow = Boolean(selectedTier?.apiModelSuffix)
		const fastModeBetas = enable1mContextWindow
			? [ANTHROPIC_FAST_MODE_BETA, "context-1m-2025-08-07"]
			: [ANTHROPIC_FAST_MODE_BETA]
		const createFastModeMessage = (
			body: AnthropicMessageCreateParamsStreaming,
		): Promise<AsyncIterable<BetaRawMessageStreamEvent>> => {
			return (
				client.beta.messages.create as unknown as (
					params: BetaMessageCreateParamsStreaming & { speed: "fast" },
				) => Promise<AsyncIterable<BetaRawMessageStreamEvent>>
			)({
				...body,
				betas: fastModeBetas,
				speed: "fast",
			})
		}

		const budget_tokens = this.thinkingBudgetTokens
		const enableThinking = this.config?.reasoning?.enableThinking ?? Boolean(this.reasoningEffort || budget_tokens > 0)

		// Tools are available only when native tools are enabled.
		const nativeToolsOn = tools?.length && tools?.length > 0
		const reasoningOn = enableThinking && (model.info.capabilities?.supportsReasoning ?? false) && budget_tokens !== 0

		// Claude Opus 4.5+ uses adaptive thinking instead of budgeted extended thinking.
		const isCustomModel = !anthropicModels[modelId]
		const hasReasoningEffort = enableThinking && this.reasoningEffort && this.reasoningEffort !== "none"
		const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(modelId) || (isCustomModel && hasReasoningEffort)
		const adaptiveThinking = isAdaptiveThinkingModel
			? resolveClaudeOpusAdaptiveThinking(this.reasoningEffort, budget_tokens)
			: undefined
		const adaptiveThinkingEnabled = adaptiveThinking?.enabled === true
		const adaptiveThinkingEffort = adaptiveThinking?.effort
		const thinkingEnabled = enableThinking && (isAdaptiveThinkingModel ? adaptiveThinkingEnabled : reasoningOn)
		const thinkingConfig = thinkingEnabled
			? isAdaptiveThinkingModel
				? ({ type: "adaptive" } as any)
				: { type: "enabled", budget_tokens: budget_tokens }
			: undefined
		const outputConfig = isAdaptiveThinkingModel && adaptiveThinkingEffort ? { effort: adaptiveThinkingEffort } : undefined

		if (model.info.capabilities?.supportsPromptCache) {
			const anthropicMessages = sanitizeAnthropicMessages(messages, true)
			const requestBody: AnthropicMessageCreateParamsStreaming & Record<string, unknown> = {
				model: apiModelId,
				thinking: thinkingConfig,
				max_tokens: model.info.capabilities?.maxTokens || 8192,
				// "Thinking isn't compatible with temperature, top_p, or top_k modifications as well as forced tool use."
				// (https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking)
				// Adaptive Claude Opus models do not support temperature.
				temperature: isAdaptiveThinkingModel ? undefined : reasoningOn ? undefined : 0,
				system: [
					{
						text: systemPrompt,
						type: "text",
						cache_control: { type: "ephemeral" },
					},
				], // setting cache breakpoint for system prompt so new tasks can reuse it
				messages: anthropicMessages,
				// tools, // cache breakpoints go from tools > system > messages, and since tools dont change, we can just set the breakpoint at the end of system (this avoids having to set a breakpoint at the end of tools which by itself does not meet min requirements for haiku caching)
				stream: true,
				tools: nativeToolsOn ? tools : undefined,
				// tool_choice options:
				// - none: disables tool use, even if tools are provided. Claude will not call any tools.
				// - auto: allows Claude to decide whether to call any provided tools or not. This is the default value when tools are provided.
				// - any: tells Claude that it must use one of the provided tools, but doesn't force a particular tool.
				// NOTE: Forcing tool use when tools are provided will result in error when thinking is also enabled.
				tool_choice: nativeToolsOn && !thinkingEnabled ? { type: "any" } : undefined,
			}
			if (outputConfig) {
				requestBody.output_config = outputConfig
			}

			stream = useFastMode
				? await createFastModeMessage(requestBody)
				: await client.messages.create(
						requestBody,
						(() => {
							// 1m context window beta header
							if (enable1mContextWindow) {
								return {
									headers: {
										"anthropic-beta": "context-1m-2025-08-07",
									},
								}
							}
							return undefined
						})(),
					)
		} else {
			const requestBody: AnthropicMessageCreateParamsStreaming & Record<string, unknown> = {
				model: apiModelId,
				max_tokens: model.info.capabilities?.maxTokens || 8192,
				temperature: isAdaptiveThinkingModel ? undefined : reasoningOn ? undefined : 0,
				system: [{ text: systemPrompt, type: "text" }],
				messages: sanitizeAnthropicMessages(messages, false),
				tools: nativeToolsOn ? tools : undefined,
				tool_choice: thinkingEnabled ? undefined : { type: "auto" },
				stream: true,
				thinking: thinkingConfig,
			}
			if (outputConfig) {
				requestBody.output_config = outputConfig
			}

			stream = useFastMode ? await createFastModeMessage(requestBody) : await client.messages.create(requestBody)
		}

		const lastStartedToolCall = { id: "", name: "", arguments: "" }

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start":
					{
						// tells us cache reads/writes/input/output
						const usage = chunk.message.usage
						yield {
							type: "usage",
							inputTokens: usage.input_tokens || 0,
							outputTokens: usage.output_tokens || 0,
							cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
							cacheReadTokens: usage.cache_read_input_tokens || undefined,
						}
					}
					break
				case "message_delta":
					// tells us stop_reason, stop_sequence, and output tokens along the way and at the end of the message

					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "message_stop":
					// no usage data, just an indicator that the message is done
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
								signature: chunk.content_block.signature,
							}
							break
						case "redacted_thinking":
							// Content is encrypted, and we don't to pass placeholder text back to the API
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
								redacted_data: chunk.content_block.data,
							}
							break
						case "tool_use":
							if (chunk.content_block.id && chunk.content_block.name) {
								// Convert Anthropic tool_use to OpenAI-compatible format
								lastStartedToolCall.id = chunk.content_block.id
								lastStartedToolCall.name = chunk.content_block.name
								lastStartedToolCall.arguments = ""
							}
							break
						case "text":
							// we may receive multiple text blocks, in which case just insert a line break between them
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							// 'reasoning' type just displays in the UI, but ant_thinking will be used to send the thinking traces back to the API
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
							break
						case "signature_delta":
							// It's used when sending the thinking block back to the API
							// API expects this in completed form, not as array of deltas
							if (chunk.delta.signature) {
								yield {
									type: "reasoning",
									reasoning: "", // reasoning text is already sent via thinking_delta
									signature: chunk.delta.signature,
								}
							}
							break
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
						case "input_json_delta":
							if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
								// 	// Convert Anthropic tool_use to OpenAI-compatible format
								yield {
									type: "tool_calls",
									tool_call: {
										...lastStartedToolCall,
										function: {
											...lastStartedToolCall,
											id: lastStartedToolCall.id,
											name: lastStartedToolCall.name,
											arguments: chunk.delta.partial_json,
										},
									},
								}
							}
							break
					}
					break

				case "content_block_stop":
					lastStartedToolCall.id = ""
					lastStartedToolCall.name = ""
					lastStartedToolCall.arguments = ""
					break
			}
		}
	}

	/**
	 * Resolve the Anthropic model ID and metadata for the current profile.
	 *
	 * @returns Configured model ID and model metadata without replacing custom IDs.
	 */
	getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const mid = this.modelId
		if (mid && this.modelInfo) {
			return {
				id: mid as AnthropicModelId,
				info: this.buildCustomModelInfo(mid),
			}
		}
		if (mid && anthropicModels[mid]) {
			const id = mid as AnthropicModelId
			return { id, info: this.buildRegistryModelInfo(id) }
		}
		if (mid) {
			return {
				id: mid as AnthropicModelId,
				info: this.buildCustomModelInfo(mid),
			}
		}
		return {
			id: anthropicDefaultModelId,
			info: this.buildRegistryModelInfo(anthropicDefaultModelId),
		}
	}
}
