import type { QueuedInputEntry } from "@shared/InputQueue"
import type { InputQueueWriteIntent } from "./InputQueueProjection"

/**
 * What a snapshot write did with the queue a ticket submitted.
 *
 * `preserved` is deliberately distinct from `written`: preserving keeps the
 * queue that is already on disk, which means the change this ticket represents
 * did not reach the file. Collapsing the two into a boolean is what let a
 * delivery treat "the old queue is still there" as "my in-flight mark is
 * durable" and send an entry that a reload would offer again.
 */
export type InputQueueWriteOutcome = "pending" | "written" | "preserved" | "failed"

/**
 * A single queue change on its way to disk.
 *
 * The intent travels here rather than on the task because a task-level field
 * outlives the transaction that set it: a failed removal would leave
 * `user_removal` behind, and the next unrelated write would use it as
 * permission to replace a queue this session never managed to read.
 */
export interface InputQueueWriteTicket {
	readonly entries: readonly QueuedInputEntry[]
	readonly intent: InputQueueWriteIntent
	outcome: InputQueueWriteOutcome
}

export function createInputQueueWriteTicket(
	entries: readonly QueuedInputEntry[],
	intent: InputQueueWriteIntent,
): InputQueueWriteTicket {
	// Copied so a queue change made while the write is in flight cannot alter
	// what this ticket claims to have submitted.
	return { entries: [...entries], intent, outcome: "pending" }
}

/**
 * Record what the writer did, keeping the first settled answer.
 *
 * Another snapshot write can run while this ticket is open; the first result
 * is the one that describes this ticket's queue, so a later success must not
 * paper over a preserve or a failure.
 */
export function recordInputQueueWriteOutcome(ticket: InputQueueWriteTicket, outcome: InputQueueWriteOutcome): void {
	if (ticket.outcome !== "pending") {
		return
	}
	ticket.outcome = outcome
}

/** Whether the queue this ticket submitted is now the queue on disk. */
export function inputQueueWriteSucceeded(ticket: InputQueueWriteTicket): boolean {
	return ticket.outcome === "written"
}
