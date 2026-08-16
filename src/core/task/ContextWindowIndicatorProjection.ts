import { estimateContextWindowCandidate } from "@core/context/context-management/context-window-projection"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import cloneDeep from "clone-deep"
import type { CompactionProviderInput } from "./compaction/CompactionRequestReplay"

const ENVIRONMENT_DETAILS_PATTERN = /<environment_details>[\s\S]*?<\/environment_details>/gi

export interface ContextWindowIndicatorSegments {
	durableContextTokens: number
	pendingSendTokens: number
	environmentTokens: number
	totalTokens: number
}

export interface EstimateContextWindowIndicatorSegmentsInput {
	providerInput: CompactionProviderInput
	/** Number of leading messages already represented by the durable segment. */
	durableMessageCount: number
}

/** Decompose one frozen Provider input into non-overlapping durable, pending-send, and environment segments. */
export function estimateContextWindowIndicatorSegments(
	input: EstimateContextWindowIndicatorSegmentsInput,
): ContextWindowIndicatorSegments {
	const totalTokens = estimateContextWindowCandidate(input.providerInput)
	const messagesWithoutEnvironment = stripEnvironmentDetails(input.providerInput.messages)
	const withoutEnvironmentTokens = Math.min(
		totalTokens,
		estimateContextWindowCandidate({ ...input.providerInput, messages: messagesWithoutEnvironment }),
	)
	const environmentTokens = Math.max(0, totalTokens - withoutEnvironmentTokens)
	const durableMessageCount = Math.max(0, Math.min(messagesWithoutEnvironment.length, Math.floor(input.durableMessageCount)))
	const durableMessages = messagesWithoutEnvironment.slice(0, durableMessageCount)
	let durableContextTokens = Math.min(
		withoutEnvironmentTokens,
		estimateContextWindowCandidate({ ...input.providerInput, messages: durableMessages }),
	)
	let pendingSendTokens = Math.max(0, withoutEnvironmentTokens - durableContextTokens)

	// Rounding can collapse a very small pending message into the fixed request envelope.
	// Keep the pending phase observable by reclassifying one token without changing the frozen total.
	if (pendingSendTokens === 0 && durableMessageCount < messagesWithoutEnvironment.length && durableContextTokens > 0) {
		durableContextTokens--
		pendingSendTokens = 1
	}

	return {
		durableContextTokens,
		pendingSendTokens,
		environmentTokens,
		totalTokens,
	}
}

/** Estimate one response chunk as a monotonic receiving-token delta until exact usage arrives. */
export function estimateContextWindowReceivingDelta(chunk: unknown): number {
	if (typeof chunk !== "object" || chunk === null) return 0
	const candidate = chunk as { type?: string; text?: string; reasoning?: string; outputTokens?: number }
	if (candidate.type === "usage") return normalizeTokens(candidate.outputTokens)
	const content = candidate.type === "text" ? candidate.text : candidate.type === "reasoning" ? candidate.reasoning : chunk
	const bytes = Buffer.byteLength(typeof content === "string" ? content : JSON.stringify(content), "utf8")
	return bytes > 0 ? Math.max(1, Math.ceil(bytes / 4)) : 0
}

function stripEnvironmentDetails(messages: readonly ClineStorageMessage[]): ClineStorageMessage[] {
	return cloneDeep(messages).map((message) => {
		if (!Array.isArray(message.content)) return message
		const content = message.content.flatMap((block) => stripEnvironmentBlock(block))
		return { ...message, content }
	})
}

function stripEnvironmentBlock(block: ClineContent): ClineContent[] {
	if (block.type !== "text") return [block]
	const text = block.text.replace(ENVIRONMENT_DETAILS_PATTERN, "").trim()
	return text ? [{ ...block, text }] : []
}

function normalizeTokens(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
