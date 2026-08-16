export interface CompactionResponseNormalization {
	assistantText: string
	removedEmptyCallCount: number
	synthesizedMissingContext: boolean
}

const TERMINAL_EMPTY_CALL = /<summarize_task\s*\/>\s*$/
const TERMINAL_PARTIAL_CALL = /<summarize_task(?:\s*\/?)?\s*$/
const COMPLETE_SUMMARY_OPEN = /<summarize_task>\s*<context>/
const EMPTY_CONTEXT_CALL = "<summarize_task><context></context></summarize_task>"

/** Normalize terminal empty compaction calls without rewriting quoted XML inside a valid summary. */
export function normalizeCompactionResponse(assistantText: string): CompactionResponseNormalization {
	let normalized = assistantText
	let removedEmptyCallCount = 0

	while (true) {
		const emptyCall = TERMINAL_EMPTY_CALL.exec(normalized)
		if (!emptyCall || emptyCall.index === undefined) break
		normalized = normalized.slice(0, emptyCall.index).trimEnd()
		removedEmptyCallCount++
	}

	if (removedEmptyCallCount > 0) {
		if (COMPLETE_SUMMARY_OPEN.test(normalized)) {
			return { assistantText: normalized, removedEmptyCallCount, synthesizedMissingContext: false }
		}
		return {
			assistantText: `${normalized}${normalized.trim() ? "\n" : ""}${EMPTY_CONTEXT_CALL}`,
			removedEmptyCallCount,
			synthesizedMissingContext: true,
		}
	}

	const partialCall = TERMINAL_PARTIAL_CALL.exec(normalized)
	if (partialCall?.index !== undefined) {
		normalized = normalized.slice(0, partialCall.index).trimEnd()
	}

	return { assistantText: normalized, removedEmptyCallCount: 0, synthesizedMissingContext: false }
}
