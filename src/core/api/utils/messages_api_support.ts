import { Anthropic } from "@anthropic-ai/sdk"
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages"
import { Tool as AnthropicTool, type ToolUnion as AnthropicToolUnion } from "@anthropic-ai/sdk/resources/messages/messages"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ServerTool } from "@/shared/proto/dline/models/metadata"
import { OutputLimitExceededError } from "../stream/OutputLimitExceededError"
import { ApiStream } from "../transform/stream"

type AnthropicMessagesStreamEvent = Anthropic.RawMessageStreamEvent | BetaRawMessageStreamEvent

function getServerToolUsage(usage: { server_tool_use?: { web_search_requests?: number } | null }) {
	const webSearchRequests = usage.server_tool_use?.web_search_requests
	return typeof webSearchRequests === "number" ? { webSearchRequests } : undefined
}

/** Merge resolved hosted declarations with local Anthropic tools without exposing duplicate web search mechanisms. */
export function mergeAnthropicServerTools(
	tools?: readonly AnthropicTool[],
	serverTools?: readonly ServerTool[],
): AnthropicToolUnion[] | undefined {
	const hostedWebSearch = serverTools?.includes(ServerTool.WEB_SEARCH) === true
	const merged: AnthropicToolUnion[] = (tools ?? [])
		.filter((tool) => !hostedWebSearch || tool.name !== "web_search")
		.map((tool) => ({ ...tool }))

	if (hostedWebSearch) {
		// The Dline Anthropic wire contract uses the unversioned hosted-search declaration.
		merged.push({ type: "web_search" } as unknown as AnthropicToolUnion)
	}

	return merged.length > 0 ? merged : undefined
}

export async function* handleAnthropicMessagesApiStreamResponse(stream: AsyncIterable<AnthropicMessagesStreamEvent>): ApiStream {
	const lastStartedToolCall = { id: "", name: "", arguments: "" }
	const activeServerToolCall = { id: "", name: "", arguments: "", input: undefined as unknown }
	const startedServerToolCallIds = new Set<string>()

	for await (const chunk of stream) {
		switch (chunk?.type) {
			case "message_start": {
				const usage = chunk.message.usage
				const serverToolUsage = getServerToolUsage(usage)
				yield {
					type: "usage",
					inputTokens: usage.input_tokens || 0,
					outputTokens: usage.output_tokens || 0,
					cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
					cacheReadTokens: usage.cache_read_input_tokens || undefined,
					...(serverToolUsage === undefined ? {} : { serverToolUsage }),
				}
				break
			}
			case "message_delta": {
				const serverToolUsage = getServerToolUsage(chunk.usage)
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
					...(serverToolUsage === undefined ? {} : { serverToolUsage }),
				}
				if (chunk.delta?.stop_reason === "max_tokens") {
					throw new OutputLimitExceededError("anthropic_messages", "max_tokens")
				}
				break
			}
			case "message_stop":
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
						// Content is encrypted, and we don't want to pass placeholder text back to the API
						yield {
							type: "reasoning",
							reasoning: "[Redacted thinking block]",
							redacted_data: chunk.content_block.data,
						}
						break
					case "tool_use":
						if (chunk.content_block.id && chunk.content_block.name) {
							activeServerToolCall.id = ""
							activeServerToolCall.name = ""
							activeServerToolCall.arguments = ""
							activeServerToolCall.input = undefined
							lastStartedToolCall.id = chunk.content_block.id
							lastStartedToolCall.name = chunk.content_block.name
							lastStartedToolCall.arguments = ""
						}
						break
					case "server_tool_use":
						if (chunk.content_block.name === "web_search") {
							startedServerToolCallIds.add(chunk.content_block.id)
							lastStartedToolCall.id = ""
							lastStartedToolCall.name = ""
							lastStartedToolCall.arguments = ""
							activeServerToolCall.id = chunk.content_block.id
							activeServerToolCall.name = chunk.content_block.name
							activeServerToolCall.arguments = ""
							activeServerToolCall.input = chunk.content_block.input
							yield {
								type: "server_tool",
								function_id: chunk.content_block.id,
								tool: ServerTool.WEB_SEARCH,
								phase: "started",
								input: chunk.content_block.input,
							}
						}
						break
					case "web_search_tool_result": {
						if (!startedServerToolCallIds.delete(chunk.content_block.tool_use_id)) break
						const result = chunk.content_block.content
						const failed = !Array.isArray(result) && result.type === "web_search_tool_result_error"
						yield {
							type: "server_tool",
							function_id: chunk.content_block.tool_use_id,
							tool: ServerTool.WEB_SEARCH,
							phase: failed ? "failed" : "completed",
							...(failed ? { error: result } : { result }),
						}
						break
					}
					case "text":
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
						yield {
							type: "reasoning",
							reasoning: chunk.delta.thinking,
						}
						break
					case "signature_delta":
						if (chunk.delta.signature) {
							yield {
								type: "reasoning",
								reasoning: "",
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
						if (activeServerToolCall.id && activeServerToolCall.name && chunk.delta.partial_json) {
							activeServerToolCall.arguments += chunk.delta.partial_json
						} else if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
							yield {
								type: "tool_calls",
								function_id: lastStartedToolCall.id,
								tool_call: {
									function: {
										name: lastStartedToolCall.name,
										arguments: chunk.delta.partial_json,
									},
								},
							}
						}
						break
				}
				break
			case "content_block_stop": {
				if (activeServerToolCall.id && activeServerToolCall.name === "web_search" && activeServerToolCall.arguments) {
					try {
						const streamedInput = JSON.parse(activeServerToolCall.arguments) as unknown
						const initialInput = activeServerToolCall.input
						const input =
							initialInput &&
							typeof initialInput === "object" &&
							streamedInput &&
							typeof streamedInput === "object" &&
							!Array.isArray(initialInput) &&
							!Array.isArray(streamedInput)
								? { ...initialInput, ...streamedInput }
								: streamedInput
						yield {
							type: "server_tool",
							function_id: activeServerToolCall.id,
							tool: ServerTool.WEB_SEARCH,
							phase: "searching",
							input,
						}
					} catch {
						// Ignore malformed partial input; the provider result still completes the lifecycle.
					}
				}
				lastStartedToolCall.id = ""
				lastStartedToolCall.name = ""
				lastStartedToolCall.arguments = ""
				activeServerToolCall.id = ""
				activeServerToolCall.name = ""
				activeServerToolCall.arguments = ""
				activeServerToolCall.input = undefined
				break
			}
		}
	}
}

export function convertOpenAIToolsToAnthropicTools(
	tools?: OpenAITool[],
	serverTools?: readonly ServerTool[],
): AnthropicToolUnion[] | undefined {
	const hostedWebSearch = serverTools?.includes(ServerTool.WEB_SEARCH) === true

	const anthropicTools: AnthropicTool[] = []

	for (const tool of tools ?? []) {
		if (tool?.type !== "function" || !tool.function?.name) {
			continue
		}
		if (hostedWebSearch && tool.function.name === "web_search") {
			continue
		}

		const fn = tool.function

		const hasSchemaObject = fn.parameters && typeof fn.parameters === "object"
		const inputSchema = hasSchemaObject ? { ...fn.parameters } : {}
		if (typeof (inputSchema as { type?: unknown }).type !== "string") {
			;(inputSchema as { type: string }).type = "object"
		}

		anthropicTools.push({
			name: fn.name,
			description: fn.description || undefined,
			input_schema: inputSchema as AnthropicTool["input_schema"],
		})
	}

	return mergeAnthropicServerTools(anthropicTools, serverTools)
}
