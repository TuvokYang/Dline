import type { ClineMessage } from "@shared/ExtensionMessage"

export interface ChatRestoreBoundary {
	readonly apiKeepCount: number
	readonly uiKeepCount: number
	readonly contextAnchorTs: number
	readonly runtimeApiIndex: number
	readonly conversationHistoryDeletedRange?: [number, number]
}

/** Resolve and validate every chat rewind boundary before any store is mutated. */
export function resolveChatRestoreBoundary(input: {
	readonly messages: readonly ClineMessage[]
	readonly messageIndex: number
	readonly apiCount: number
	readonly uiCount: number
}): ChatRestoreBoundary {
	const { messages, messageIndex, apiCount, uiCount } = input
	const message = messages[messageIndex]
	if (!message) throw new Error(`Restore message index ${messageIndex} is unavailable`)
	if (uiCount !== messages.length) {
		throw new Error(`Restore UI history is stale: loaded=${messages.length}, durable=${uiCount}`)
	}

	const compactionRange = message.compactionConversationRange
	if (compactionRange) {
		const [turnStart, turnEnd] = compactionRange.logicalTurnRange
		const [apiStart, apiEnd] = compactionRange.apiConversationRange
		const preCompactionApiEndIndex = compactionRange.preCompactionApiEndIndex
		if (
			![turnStart, turnEnd, apiStart, apiEnd, preCompactionApiEndIndex].every(Number.isInteger) ||
			turnStart < 0 ||
			turnEnd < turnStart ||
			apiStart < 0 ||
			apiEnd < apiStart ||
			apiEnd > preCompactionApiEndIndex ||
			preCompactionApiEndIndex >= apiCount ||
			message.conversationHistoryIndex !== preCompactionApiEndIndex ||
			messageIndex <= 0
		) {
			throw new Error("Compaction Restore boundary is inconsistent with the current conversation")
		}
		validateDeletedRange(message.conversationHistoryDeletedRange, preCompactionApiEndIndex + 1)
		return {
			apiKeepCount: preCompactionApiEndIndex + 1,
			uiKeepCount: messageIndex,
			contextAnchorTs: messages[messageIndex - 1].ts,
			runtimeApiIndex: preCompactionApiEndIndex,
			conversationHistoryDeletedRange: cloneDeletedRange(message.conversationHistoryDeletedRange),
		}
	}

	const userMessageIndex = (message.conversationHistoryIndex ?? -1) + 1
	// An ordinary card points at the assistant message of its round, so the round is
	// kept through the following user message. A failed compaction card is anchored to
	// the last assistant message of an unfinished round and has no successor user
	// message, so the same arithmetic would run one past the end of the conversation.
	// Clamp to the conversation length instead of rejecting a legitimate restore.
	const apiKeepCount = Math.min(userMessageIndex + 1, apiCount)
	if (!Number.isInteger(apiKeepCount) || apiKeepCount < 0 || userMessageIndex > apiCount) {
		throw new Error("Restore API boundary is outside the current conversation")
	}
	validateDeletedRange(message.conversationHistoryDeletedRange, apiKeepCount)
	return {
		apiKeepCount,
		uiKeepCount: messageIndex + 1,
		contextAnchorTs: message.ts,
		runtimeApiIndex: apiKeepCount - 1,
		conversationHistoryDeletedRange: cloneDeletedRange(message.conversationHistoryDeletedRange),
	}
}

function validateDeletedRange(range: [number, number] | undefined, apiKeepCount: number): void {
	if (!range) return
	const [start, end] = range
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= apiKeepCount) {
		throw new Error("Restore deleted range is outside the target API boundary")
	}
}

function cloneDeletedRange(range: [number, number] | undefined): [number, number] | undefined {
	return range ? [...range] : undefined
}
