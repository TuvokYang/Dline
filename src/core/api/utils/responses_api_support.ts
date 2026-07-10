import OpenAI from "openai"
import { ModelInfo } from "@/shared/api"
import { Logger } from "@/shared/services/Logger"
import { createResponsesRegistry, createResponsesToolChunk } from "../transform/responses-identity-registry"

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
	// Process the response stream
	for await (const chunk of stream) {
		// Handle different event types from Responses API
		if (chunk.type === "response.output_item.added") {
			const item = chunk.item
			if (item.type === "function_call" && item.id) {
				const identity = identityRegistry.registerItem({
					itemId: item.id,
					functionId: item.call_id,
					name: item.name,
				})
				yield createResponsesToolChunk(identity, item.arguments)
			}
			if (item.type === "reasoning" && item.encrypted_content && item.id) {
				yield {
					type: "reasoning",
					id: item.id,
					reasoning: "",
					redacted_data: item.encrypted_content,
				} as const
			}
		}
		if (chunk.type === "response.output_item.done") {
			const item = chunk.item
			if (item.type === "function_call" && item.id) {
				const identity = identityRegistry.registerItem({
					itemId: item.id,
					functionId: item.call_id,
					name: item.name,
				})
				yield createResponsesToolChunk(identity, item.arguments)
			}
			if (item.type === "reasoning") {
				yield {
					type: "reasoning",
					id: item.id,
					details: item.summary,
					reasoning: "",
				} as const
			}
		}
		if (chunk.type === "response.reasoning_summary_part.added") {
			yield {
				type: "reasoning",
				id: chunk.item_id,
				reasoning: chunk.part.text,
			} as const
		}
		if (chunk.type === "response.reasoning_summary_text.delta") {
			yield {
				type: "reasoning",
				id: chunk.item_id,
				reasoning: chunk.delta,
			} as const
		}
		if (chunk.type === "response.reasoning_summary_part.done") {
			yield {
				type: "reasoning",
				id: chunk.item_id,
				details: chunk.part,
				reasoning: "",
			} as const
		}
		if (chunk.type === "response.output_text.delta") {
			// Handle text content deltas
			if (chunk.delta) {
				yield {
					id: chunk.item_id,
					type: "text",
					text: chunk.delta,
				} as const
			}
		}
		if (chunk.type === "response.reasoning_text.delta") {
			// Handle reasoning content deltas
			if (chunk.delta) {
				yield {
					id: chunk.item_id,
					type: "reasoning",
					reasoning: chunk.delta,
				} as const
			}
		}
		if (chunk.type === "response.function_call_arguments.delta") {
			const identity = identityRegistry.requireItem(chunk.item_id)
			yield createResponsesToolChunk(identity, chunk.delta)
		}
		if (chunk.type === "response.function_call_arguments.done") {
			if (chunk.item_id && chunk.name && chunk.arguments) {
				const identity = identityRegistry.requireItem(chunk.item_id)
				yield createResponsesToolChunk(identity, chunk.arguments)
			}
		}

		if (
			chunk.type === "response.incomplete" &&
			chunk.response?.status === "incomplete" &&
			chunk.response?.incomplete_details?.reason === "max_output_tokens"
		) {
			Logger.log("Ran out of tokens")
			if (chunk.response?.output_text?.length > 0) {
				Logger.log("Partial output:", chunk.response.output_text)
			} else {
				Logger.log("Ran out of tokens during reasoning")
			}
		}

		if (chunk.type === "response.completed" && chunk.response?.usage) {
			// Handle usage information when response is complete
			const usage = chunk.response.usage
			const inputTokens = usage.input_tokens || 0
			const outputTokens = usage.output_tokens || 0
			const cacheReadTokens = usage.output_tokens_details?.reasoning_tokens || 0
			const cacheWriteTokens = usage.input_tokens_details?.cached_tokens || 0
			const totalTokens = usage.total_tokens || 0
			const totalCost = await calculateCost(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			Logger.log(`Total tokens from Responses API usage: ${totalTokens}`)
			const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
			yield {
				type: "usage",
				inputTokens: nonCachedInputTokens,
				outputTokens: outputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
				totalCost: totalCost,
				id: chunk.response.id,
			} as const
		}
	}
}
