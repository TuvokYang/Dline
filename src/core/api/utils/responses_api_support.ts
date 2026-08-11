import OpenAI from "openai"
import { ModelInfo } from "@/shared/api"
import { ServerTool } from "@/shared/proto/dline/models/metadata"
import { Logger } from "@/shared/services/Logger"
import { createResponsesRegistry, createResponsesToolChunk } from "../transform/responses-identity-registry"
import type { ApiRawStreamServerToolChunk, ApiServerToolPhase } from "../transform/stream"

interface ResponsesInputTokenDetails {
	readonly cache_write_tokens?: number | null
	readonly cache_miss_tokens?: number | null
}

/** Read official Responses cache-write usage while retaining compatible-provider fallback support. */
export function getResponsesCacheWriteTokens(details: ResponsesInputTokenDetails | null | undefined): number {
	return details?.cache_write_tokens ?? details?.cache_miss_tokens ?? 0
}

function createWebSearchChunk(
	functionId: string,
	phase: ApiServerToolPhase,
	payload?: Pick<ApiRawStreamServerToolChunk, "input" | "result" | "error">,
): ApiRawStreamServerToolChunk {
	return {
		type: "server_tool",
		function_id: functionId,
		provider_metadata: { item_id: functionId },
		tool: ServerTool.WEB_SEARCH,
		phase,
		...payload,
	}
}

/** Normalize the provider-native Responses hosted Web Search lifecycle. */
export function mapResponsesWebSearchEvent(event: any): ApiRawStreamServerToolChunk | undefined {
	if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
		const item = event.item
		if (item?.type !== "web_search_call" || typeof item.id !== "string" || item.id.length === 0) {
			return undefined
		}
		if (event.type === "response.output_item.added") {
			return createWebSearchChunk(item.id, "started", { input: item.action })
		}
		return item.status === "failed"
			? createWebSearchChunk(item.id, "failed", { error: item.action })
			: createWebSearchChunk(item.id, "completed", {
					result: {
						action: item.action,
						...(Array.isArray(item.results) ? { results: item.results } : {}),
					},
				})
	}

	if (
		event?.type !== "response.web_search_call.in_progress" &&
		event?.type !== "response.web_search_call.searching" &&
		event?.type !== "response.web_search_call.completed"
	) {
		return undefined
	}

	const functionId = event.item_id
	if (typeof functionId !== "string" || functionId.length === 0) {
		return undefined
	}
	const phase: ApiServerToolPhase =
		event.type === "response.web_search_call.in_progress"
			? "in_progress"
			: event.type === "response.web_search_call.searching"
				? "searching"
				: "completed"
	return createWebSearchChunk(functionId, phase)
}

// Type that represents the OpenAI ResponseStream with its private properties
// The #private property issue can be resolved by using the AsyncIterable interface
export async function* handleResponsesApiStreamResponse(
	stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent> & { _request_id?: string | null },
	modelInfo: ModelInfo,
	calculateCost: (
		modelInfo: ModelInfo,
		inputTokens: number,
		outputTokens: number,
		cacheWriteTokens: number,
		cacheReadTokens: number,
	) => Promise<number>,
) {
	const identityRegistry = createResponsesRegistry("responses-api-support")
	const streamedArgumentItems = new Set<string>()
	const emittedArgumentSnapshots = new Set<string>()
	const completedArgumentItems = new Set<string>()
	const pendingArgumentSnapshots = new Map<string, string>()
	try {
		// Process the response stream
		for await (const chunk of stream) {
			const webSearchChunk = mapResponsesWebSearchEvent(chunk)
			if (webSearchChunk) {
				yield webSearchChunk
			}

			// Handle different event types from Responses API.
			// Compatible gateways and aborted streams can emit output_item events
			// without an item payload; guard every access instead of crashing on
			// "Cannot read properties of undefined (reading 'type')".
			if (chunk.type === "response.output_item.added") {
				const item = chunk.item
				if (!item) continue
				if (item.type === "function_call" && item.id) {
					identityRegistry.registerItem({
						itemId: item.id,
						functionId: item.call_id,
						name: item.name,
					})
					if (item.arguments) {
						pendingArgumentSnapshots.set(item.id, item.arguments)
					}
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						provider_metadata: { response_id: item.id },
						reasoning: "",
						redacted_data: item.encrypted_content,
					} as const
				}
			}
			if (chunk.type === "response.output_item.done") {
				const item = chunk.item
				if (!item) continue
				if (item.type === "function_call" && item.id) {
					const identity = identityRegistry.registerItem({
						itemId: item.id,
						functionId: item.call_id,
						name: item.name,
					})
					const completedArguments = item.arguments || pendingArgumentSnapshots.get(item.id)
					if (completedArguments && !streamedArgumentItems.has(item.id) && !emittedArgumentSnapshots.has(item.id)) {
						emittedArgumentSnapshots.add(item.id)
						yield createResponsesToolChunk(identity, completedArguments, "delta")
					}
					if (!completedArgumentItems.has(item.id)) {
						completedArgumentItems.add(item.id)
						yield createResponsesToolChunk(identity, undefined, "completed")
					}
					pendingArgumentSnapshots.delete(item.id)
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						provider_metadata: { response_id: item.id },
						details: item.summary,
						reasoning: "",
					} as const
				}
			}
			if (chunk.type === "response.reasoning_summary_part.added") {
				const part = chunk.part
				if (!part) continue
				yield {
					type: "reasoning",
					provider_metadata: { response_id: chunk.item_id },
					reasoning: part.text,
				} as const
			}
			if (chunk.type === "response.reasoning_summary_text.delta") {
				yield {
					type: "reasoning",
					provider_metadata: { response_id: chunk.item_id },
					reasoning: chunk.delta,
				} as const
			}
			if (chunk.type === "response.reasoning_summary_part.done") {
				const part = chunk.part
				if (!part) continue
				yield {
					type: "reasoning",
					provider_metadata: { response_id: chunk.item_id },
					details: part,
					reasoning: "",
				} as const
			}
			if (chunk.type === "response.output_text.delta") {
				// Handle text content deltas
				if (chunk.delta) {
					yield {
						type: "text",
						provider_metadata: { response_id: chunk.item_id },
						text: chunk.delta,
					} as const
				}
			}
			if (chunk.type === "response.reasoning_text.delta") {
				// Handle reasoning content deltas
				if (chunk.delta) {
					yield {
						type: "reasoning",
						provider_metadata: { response_id: chunk.item_id },
						reasoning: chunk.delta,
					} as const
				}
			}
			if (chunk.type === "response.function_call_arguments.delta") {
				const identity = identityRegistry.requireItem(chunk.item_id)
				streamedArgumentItems.add(chunk.item_id)
				pendingArgumentSnapshots.delete(chunk.item_id)
				if (chunk.delta) {
					yield createResponsesToolChunk(identity, chunk.delta, "delta")
				}
			}
			if (chunk.type === "response.function_call_arguments.done") {
				if (chunk.item_id && chunk.name && chunk.arguments) {
					const identity = identityRegistry.requireItem(chunk.item_id)
					if (!streamedArgumentItems.has(chunk.item_id) && !emittedArgumentSnapshots.has(chunk.item_id)) {
						emittedArgumentSnapshots.add(chunk.item_id)
						yield createResponsesToolChunk(identity, chunk.arguments, "delta")
					}
					if (!completedArgumentItems.has(chunk.item_id)) {
						completedArgumentItems.add(chunk.item_id)
						yield createResponsesToolChunk(identity, undefined, "completed")
					}
					pendingArgumentSnapshots.delete(chunk.item_id)
				}
			}

			if (
				chunk.type === "response.incomplete" &&
				chunk.response?.status === "incomplete" &&
				chunk.response?.incomplete_details?.reason === "max_output_tokens"
			) {
				throw new Error("Responses API request incomplete: max_output_tokens")
			}

			if (chunk.type === "response.failed") {
				// A failed response carries the provider's real error. Surface it
				// instead of silently ending the stream: an empty generator would be
				// mistaken for a successful first chunk upstream and crash on
				// "Cannot read properties of undefined (reading 'type')".
				const failure = chunk.response?.error
				const failureMessage = failure
					? `${failure.code ?? "unknown"}: ${failure.message}`
					: "response.failed without error details"
				throw new Error(`Responses API request failed: ${failureMessage}`)
			}

			if (chunk.type === "response.completed") {
				for (const [itemId, argumentsText] of pendingArgumentSnapshots) {
					if (streamedArgumentItems.has(itemId) || emittedArgumentSnapshots.has(itemId)) continue
					const identity = identityRegistry.requireItem(itemId)
					emittedArgumentSnapshots.add(itemId)
					yield createResponsesToolChunk(identity, argumentsText, "delta")
					if (!completedArgumentItems.has(itemId)) {
						completedArgumentItems.add(itemId)
						yield createResponsesToolChunk(identity, undefined, "completed")
					}
				}
				pendingArgumentSnapshots.clear()
			}

			if (chunk.type === "response.completed" && chunk.response?.usage) {
				// Handle usage information when response is complete
				const usage = chunk.response.usage
				const inputTokens = usage.input_tokens || 0
				const outputTokens = usage.output_tokens || 0
				const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0
				const cacheWriteTokens = getResponsesCacheWriteTokens(usage.input_tokens_details)
				const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0
				const totalTokens = usage.total_tokens || 0
				const totalCost = await calculateCost(
					modelInfo,
					inputTokens,
					outputTokens + reasoningTokens,
					cacheWriteTokens,
					cacheReadTokens,
				)
				Logger.log(`Total tokens from Responses API usage: ${totalTokens}`)
				const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
				yield {
					type: "usage",
					inputTokens: nonCachedInputTokens,
					outputTokens: outputTokens,
					cacheWriteTokens: cacheWriteTokens,
					cacheReadTokens: cacheReadTokens,
					thoughtsTokenCount: reasoningTokens,
					totalCost: totalCost,
					provider_metadata: { response_id: chunk.response.id },
				} as const
			}
		}
	} catch (error) {
		Logger.error(
			`[ResponsesStream] stream processing failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
		)
		throw error
	}
}
