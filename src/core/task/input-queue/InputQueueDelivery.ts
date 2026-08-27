import type { InputQueue, QueuedInputEntry } from "./InputQueue"

/**
 * Where the task currently sits when the queue is consulted.
 *
 * - `turn-end`: the assistant turn has ended and the task is about to wait for
 *   the user, so a queued entry may take the turn.
 * - `tool-round`: an ordinary tool round finished while the task keeps running;
 *   only steering entries may ride along here.
 */
export type QueueDeliveryPoint = "turn-end" | "tool-round"

/**
 * Shared preamble attached to every delivered batch. It states that queued
 * input is auxiliary alignment information so the model does not treat it as a
 * replacement for the approved plan unless the user says so explicitly.
 */
export const QUEUED_INPUT_GUIDANCE =
	"The following blocks are auxiliary alignment information the user queued while work was in progress. " +
	"Use them to align subsequent execution. Unless the user explicitly asks for a different approach, " +
	"keep the agreed plan and apply only minor adjustments."

export interface QueueDelivery {
	/** Which pool produced this batch; steering always takes priority. */
	readonly kind: "queued" | "steering"
	readonly entries: readonly QueuedInputEntry[]
	/**
	 * One rendered block per entry, each already wrapped in its own
	 * `<user_message>` tags. Callers append these as separate text blocks so a
	 * batch reads as several distinct messages rather than one merged note.
	 */
	readonly blocks: readonly string[]
	/**
	 * Flat payload for callers that can only carry a single string, such as the
	 * turn-end interaction draft. A batch keeps its per-entry `<user_message>`
	 * boundaries here too, because the receiving handler wraps the whole string
	 * once and would otherwise merge several messages into one.
	 */
	readonly text: string
	readonly images: readonly string[]
	readonly files: readonly string[]
	/** Discard the entries once the delivery is known to have landed. */
	commit(): void
	/** Return the entries to the user's queue when delivery failed. */
	restore(): void
	/**
	 * Rebuild this batch without the entries the user removed since the claim.
	 *
	 * Removal outranks a delivery that has not sent yet, and a remove request
	 * can land after the claim. Callers narrow the batch immediately before
	 * handing it over so a cancelled entry is not sent anyway.
	 *
	 * @returns the remaining batch, or undefined when nothing is left to send.
	 */
	withoutCancelled(): QueueDelivery | undefined
}

function renderBlocks(entries: readonly QueuedInputEntry[]): string[] {
	return entries.map((entry) => `<user_message>\n${entry.text}\n</user_message>`)
}

function buildDelivery(queue: InputQueue, kind: QueueDelivery["kind"], entries: readonly QueuedInputEntry[]): QueueDelivery {
	const blocks = renderBlocks(entries)
	const ids = entries.map((entry) => entry.id)
	// A single entry is sent as-is: the receiving handler already presents it as
	// one message, so extra tags would only add noise. Several entries keep
	// their tags so they stay distinguishable inside the one string.
	const body = entries.length > 1 ? blocks : entries.map((entry) => entry.text)
	return {
		kind,
		entries,
		blocks,
		text: [QUEUED_INPUT_GUIDANCE, ...body].join("\n\n"),
		images: entries.flatMap((entry) => [...entry.images]),
		files: entries.flatMap((entry) => [...entry.files]),
		commit: () => queue.commitClaim(ids),
		restore: () => queue.releaseClaim(ids),
		withoutCancelled: () => {
			// Evaluated on call, not when the batch was built: the whole point is
			// to see removals that landed after the claim was taken.
			const live = entries.filter((entry) => !queue.isCancelled(entry.id))
			if (live.length === entries.length) return buildDelivery(queue, kind, entries)
			// Settle the cancelled ids here so their claim does not outlive the
			// batch; the remaining entries keep theirs until the caller settles.
			queue.commitClaim(ids.filter((id) => queue.isCancelled(id)))
			return live.length > 0 ? buildDelivery(queue, kind, live) : undefined
		},
	}
}

/**
 * Claim the batch owed to the current delivery point.
 *
 * The entries are only hidden from the user's queue, not removed: the caller
 * decides their fate with `commit()` or `restore()` once the delivery outcome is
 * known, so a rejected delivery cannot lose input and cannot reappear in the
 * wrong position after a concurrent reorder.
 *
 * Steering entries always win the round; a queued entry displaced by steering is
 * deferred to the next turn end rather than dropped. Entries under edit are held
 * back individually until the user commits the edit.
 */
export function takeQueueDelivery(queue: InputQueue, point: QueueDeliveryPoint): QueueDelivery | undefined {
	const steering = queue.takeSteeringBatch()
	if (steering.length > 0) {
		return buildDelivery(queue, "steering", steering)
	}
	if (point !== "turn-end") {
		return undefined
	}
	const queued = queue.takeNextQueued()
	return queued ? buildDelivery(queue, "queued", [queued]) : undefined
}
