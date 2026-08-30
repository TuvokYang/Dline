import type { QueuedInputEntry } from "@shared/InputQueue"

/** Whether the queue on disk could not be read and must not be overwritten. */
export interface InputQueueWriteContext {
	/** The queue as the last completed transaction left it, if one has run. */
	readonly committed: readonly QueuedInputEntry[] | undefined
	/** Whatever the snapshot being written already carries. */
	readonly persisted: readonly QueuedInputEntry[] | undefined
	/**
	 * Set when reading the snapshot failed for a reason other than the file
	 * being absent. The queue on disk may still hold input, and nothing in
	 * memory can be trusted to replace it.
	 */
	readonly readFailed: boolean
	/** What kind of change this write is recording. */
	readonly intent: InputQueueWriteIntent
}

/**
 * Whether a queue change may replace a queue that could not be read.
 *
 * Only an explicit removal is allowed to drop an entry, so an unreadable file
 * stays authoritative through ordinary changes: enqueueing one entry must not
 * be taken as permission to discard everything the file may still hold. A
 * removal, on the other hand, is the user saying the entry is unwanted, and
 * they can only be looking at what this session managed to show them.
 */
export type InputQueueWriteIntent = "ordinary" | "user_removal"

/** What a snapshot write should do with the input queue field. */
export type InputQueueWriteDecision =
	| { readonly kind: "write"; readonly entries: QueuedInputEntry[] | undefined }
	/** Rewrite the snapshot but leave the queue field on disk untouched. */
	| { readonly kind: "preserve" }

/**
 * Decide what a snapshot write should record for the input queue.
 *
 * Snapshots are written by runtime activity that knows nothing about the queue,
 * so a write can happen before the queue has been read from disk. Treating that
 * unknown state as "empty" would let an ordinary runtime write erase input the
 * user queued in a previous session, which the queue contract forbids: only an
 * explicit removal may drop an entry.
 */
export function resolveInputQueueWrite(context: InputQueueWriteContext): InputQueueWriteDecision {
	if (context.readFailed && context.intent !== "user_removal") {
		// What the file holds is unknown, and an ordinary change is not the
		// user asking to discard it.
		return { kind: "preserve" }
	}
	if (context.committed !== undefined) {
		return { kind: "write", entries: [...context.committed] }
	}
	if (context.readFailed) {
		return { kind: "preserve" }
	}
	return { kind: "write", entries: context.persisted ? [...context.persisted] : undefined }
}
