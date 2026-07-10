import type { IdentityFactory } from "./block-identity"
import type {
	ApiCanonicalStream,
	ApiLegacyStreamToolCallsChunk,
	ApiRawStreamChunk,
	ApiRawStreamToolCallsChunk,
	ApiStream,
	ApiStreamChunk,
	ApiStreamToolCallsChunk,
} from "./stream"

/** Canonical identity allocated for one response-local native tool position. */
interface ToolIdentityState {
	item_id: string
	dline_tid: string
	function_id: string
}

/** Converts provider raw stream chunks into canonical Dline stream chunks. */
export interface StreamIdentityNormalizer {
	/**
	 * Normalize one provider stream chunk.
	 *
	 * @param chunk Provider-neutral raw stream chunk.
	 * @returns Canonical chunk with stable Dline identities.
	 */
	normalize(chunk: ApiRawStreamChunk): ApiStreamChunk
	/** Clear response-local block identity state. */
	endResponse(): void
}

/**
 * Convert a provider stream into a canonical runtime stream.
 *
 * @param stream Provider stream that may contain raw or legacy chunks.
 * @param normalizer Response-local identity normalizer.
 * @returns Canonical stream accepted by runtime consumers.
 */
export function normalizeApiStream(stream: ApiStream, normalizer: StreamIdentityNormalizer): ApiCanonicalStream {
	const normalized = (async function* (): AsyncGenerator<ApiStreamChunk> {
		try {
			for await (const chunk of stream) {
				yield normalizer.normalize(chunk)
			}
		} finally {
			normalizer.endResponse()
		}
	})() as ApiCanonicalStream
	normalized.id = stream.id
	return normalized
}

/**
 * Create a response-local canonical stream normalizer.
 *
 * @param factory Task-local allocator for Dline-owned identities.
 * @returns Stream normalizer that preserves provider function identities.
 */
export function createStreamNormalizer(factory: IdentityFactory): StreamIdentityNormalizer {
	const toolStates = new Map<string, ToolIdentityState>()

	/**
	 * Determine whether a tool chunk is already canonical.
	 *
	 * @param chunk Provider stream chunk.
	 * @returns True when Dline trace identity has already been assigned.
	 */
	function isCanonicalTool(chunk: ApiRawStreamChunk): chunk is ApiStreamToolCallsChunk {
		return chunk.type === "tool_calls" && typeof chunk.dline_tid === "string"
	}

	/**
	 * Determine whether a tool chunk carries a provider function identity but no Dline trace identity.
	 *
	 * @param chunk Provider stream chunk.
	 * @returns True when the chunk is ready for canonical normalization.
	 */
	function isRawTool(chunk: ApiRawStreamChunk): chunk is ApiRawStreamToolCallsChunk {
		return chunk.type === "tool_calls" && typeof chunk.function_id === "string" && typeof chunk.dline_tid !== "string"
	}

	/**
	 * Resolve a stable response-local key for a native tool chunk.
	 *
	 * @param chunk Raw native tool chunk.
	 * @returns Key that preserves interleaved tool identity.
	 */
	function getToolKey(chunk: ApiRawStreamToolCallsChunk): string {
		return chunk.tool_index === undefined ? `function:${chunk.function_id}` : `index:${chunk.tool_index}`
	}

	/**
	 * Normalize a native tool chunk without changing its provider pairing ID.
	 *
	 * @param chunk Raw native tool chunk.
	 * @returns Canonical native tool chunk.
	 */
	function normalizeTool(chunk: ApiRawStreamToolCallsChunk): ApiStreamToolCallsChunk {
		const key = getToolKey(chunk)
		const existing = toolStates.get(key)
		if (existing && existing.function_id !== chunk.function_id) {
			throw new Error(`Stream identity conflict for ${key}: ${existing.function_id} !== ${chunk.function_id}`)
		}
		const state =
			existing ??
			({
				item_id: chunk.item_id ?? factory.nextItemId(),
				dline_tid: factory.nextTraceId(),
				function_id: chunk.function_id,
			} satisfies ToolIdentityState)
		toolStates.set(key, state)
		return {
			...chunk,
			item_id: state.item_id,
			dline_tid: state.dline_tid,
			function_id: state.function_id,
		}
	}

	/**
	 * Convert a legacy provider tool chunk to the raw canonical ingress shape.
	 *
	 * @param chunk Legacy tool chunk produced by an unmigrated provider.
	 * @returns Raw tool chunk with provider pairing identity promoted to function_id.
	 */
	function promoteLegacyTool(chunk: ApiLegacyStreamToolCallsChunk): ApiRawStreamToolCallsChunk {
		const functionId = chunk.tool_call.function.id ?? chunk.tool_call.call_id
		if (!functionId) {
			throw new Error("Legacy native tool chunk is missing provider function identity")
		}
		return {
			...chunk,
			function_id: functionId,
		}
	}

	return {
		normalize(chunk: ApiRawStreamChunk): ApiStreamChunk {
			if (chunk.type !== "tool_calls") {
				return chunk
			}
			if (isCanonicalTool(chunk)) {
				return chunk
			}
			if (isRawTool(chunk)) {
				return normalizeTool(chunk)
			}
			return normalizeTool(promoteLegacyTool(chunk))
		},
		endResponse(): void {
			toolStates.clear()
		},
	}
}
