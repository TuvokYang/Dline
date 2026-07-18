import { describe, expect, it } from "vitest"
import { createIdentityFactory } from "../block-identity"
import type { ApiRawStreamToolCallsChunk } from "../stream"
import { createStreamNormalizer } from "../stream-identity-normalizer"

/**
 * Create a deterministic identity source for stream normalization tests.
 *
 * @param values Ordered identity suffixes.
 * @returns Function returning the next suffix.
 */
function createSource(values: string[]): () => string {
	let index = 0
	return () => {
		const value = values[index]
		index += 1
		if (value === undefined) throw new Error("Identity source exhausted")
		return value
	}
}

/**
 * Create a raw native tool chunk.
 *
 * @param functionId Provider function pairing identity.
 * @param index Provider response-local tool position.
 * @param argumentsText Tool argument delta.
 * @returns Raw provider tool chunk.
 */
function createToolChunk(functionId: string, index: number, argumentsText: string, itemId?: string): ApiRawStreamToolCallsChunk {
	return {
		type: "tool_calls",
		function_id: functionId,
		provider_metadata: itemId ? { item_id: itemId } : undefined,
		tool_index: index,
		tool_call: {
			function: {
				name: "read_file",
				arguments: argumentsText,
			},
		},
	}
}

describe("StreamIdentityNormalizer", () => {
	it("preserves provider function identity while allocating Dline identities", () => {
		const factory = createIdentityFactory(createSource(["TRACE"]))
		const normalizer = createStreamNormalizer(factory)

		const chunk = normalizer.normalize(createToolChunk("call_provider_1", 0, "{}", "fc_item_1"))

		expect(chunk.type).toBe("tool_calls")
		if (chunk.type !== "tool_calls") throw new Error("Expected tool chunk")
		expect(chunk.function_id).toBe("call_provider_1")
		expect(chunk.provider_metadata?.item_id).toBe("fc_item_1")
		expect(chunk.dline_tid).toBe("dline_tid_TRACE")
	})

	it("reuses identities for interleaved deltas of the same tool index", () => {
		const factory = createIdentityFactory(createSource(["TRACE0", "TRACE1"]))
		const normalizer = createStreamNormalizer(factory)

		const first = normalizer.normalize(createToolChunk("call_0", 0, '{"path":', "fc_item_0"))
		const second = normalizer.normalize(createToolChunk("call_1", 1, '{"path":"b"}', "fc_item_1"))
		const finalFirst = normalizer.normalize(createToolChunk("call_0", 0, '"a"}', "fc_item_0"))

		if (first.type !== "tool_calls" || second.type !== "tool_calls" || finalFirst.type !== "tool_calls") {
			throw new Error("Expected tool chunks")
		}
		expect(finalFirst.provider_metadata?.item_id).toBe(first.provider_metadata?.item_id)
		expect(finalFirst.dline_tid).toBe(first.dline_tid)
		expect(second.provider_metadata?.item_id).not.toBe(first.provider_metadata?.item_id)
		expect(second.dline_tid).not.toBe(first.dline_tid)
	})
})
