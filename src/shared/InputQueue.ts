/**
 * Cross-boundary input queue types.
 *
 * The queue itself is owned by the backend Task; these are the plain data
 * shapes that travel to the Webview through ExtensionState. They live in
 * `shared` so the Webview never has to import from `core`.
 */

/** Maximum number of retained entries. Enqueue is refused beyond this. */
export const INPUT_QUEUE_LIMIT = 32

/**
 * Delivery state of an entry.
 *
 * This is a user-toggled state, not an enqueue-time parameter: every entry
 * starts as `queued`, and clicking send promotes it to `steering` in place.
 */
export type InputQueueMode = "queued" | "steering"

/** One retained input with its delivery state and user-controlled order. */
export interface QueuedInputEntry {
	readonly id: string
	readonly text: string
	readonly images: readonly string[]
	readonly files: readonly string[]
	readonly activeQuote?: string
	readonly mode: InputQueueMode
	/** Blocks delivery of this entry only, while the user edits it. */
	readonly editing?: boolean
	/**
	 * Set while the entry has been handed to a delivery that has not settled.
	 *
	 * Persisted deliberately. Without it a crash between handing the input to
	 * the model and recording that fact would restore the entry as deliverable
	 * and send it a second time. A restored `delivering` entry is dropped
	 * instead: at-most-once is the safer default for an instruction, because a
	 * silently repeated one can undo work, while a lost one is visible to the
	 * user, who still has the text in their own history.
	 */
	readonly delivering?: boolean
	/**
	 * Position of the entry in the user's chosen order.
	 *
	 * Renumbered whenever the list changes, so it survives a reload as the
	 * ordering the user last saw. The array order is authoritative in memory;
	 * this is what carries that order across serialization.
	 */
	readonly sequence: number
}
