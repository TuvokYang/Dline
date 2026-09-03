import { type HistoryItem, MAX_HISTORY_TASK_TEXT_LENGTH, summarizeHistoryTaskText } from "@/shared/HistoryItem"

/**
 * Keeps the pushed task history bounded by the history label contract.
 *
 * Entries are summarized when they are written, so this normally returns its
 * input untouched. It still runs on the push path because histories persisted
 * before that rule existed still hold verbatim task text, and pushing those at
 * their original size is exactly what made state payloads reach megabytes: the
 * 100-entry cap in `buildState()` limits how many entries are sent, not how
 * many bytes each one carries.
 */

export interface TaskHistoryProjection {
	items: HistoryItem[]
	/** Entries whose task text was shortened; 0 means the list was already bounded. */
	truncatedCount: number
}

/**
 * Returns history entries whose task text respects the history label length.
 *
 * Entries are copied rather than mutated: the input belongs to the shared
 * global state cache, and shortening it in place would replace the stored text
 * for every later reader.
 */
export function projectTaskHistory(items: readonly HistoryItem[] | undefined): TaskHistoryProjection {
	if (!items || items.length === 0) {
		return { items: [], truncatedCount: 0 }
	}

	let truncatedCount = 0
	const projected = items.map((item) => {
		if (typeof item.task !== "string" || item.task.length <= MAX_HISTORY_TASK_TEXT_LENGTH) {
			return item
		}
		truncatedCount++
		return { ...item, task: summarizeHistoryTaskText(item.task) }
	})

	return { items: projected, truncatedCount }
}
