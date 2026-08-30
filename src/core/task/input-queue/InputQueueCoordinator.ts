import type { QueuedInputEntry } from "@shared/InputQueue"
import { Logger } from "@shared/services/Logger"
import { InputQueue } from "./InputQueue"
import { type QueueDelivery, takeQueueDelivery } from "./InputQueueDelivery"
import { InputQueueGate } from "./InputQueueGate"
import { applyInputQueueMutation, type InputQueueMutation, type InputQueueMutationResult } from "./InputQueueMutation"
import { type InputQueueWriteDecision, type InputQueueWriteIntent, resolveInputQueueWrite } from "./InputQueueProjection"
import {
	createInputQueueWriteTicket,
	type InputQueueWriteOutcome,
	type InputQueueWriteTicket,
	inputQueueWriteSucceeded,
	recordInputQueueWriteOutcome,
} from "./InputQueueWriteTicket"

/**
 * What the coordinator needs from its host to do its work.
 *
 * Declared as a port so the coordinator never holds the task itself. Delivery
 * and persistence are the task's concerns; owning the queue's state machine is
 * the coordinator's. Keeping the dependency one-way is also what makes the
 * failure paths testable — every one of them is reachable by failing a port.
 */
export interface InputQueueHost {
	/**
	 * Write the current queue to disk through the task's snapshot chain.
	 *
	 * Rejects when the write fails. Resolving does not by itself mean the queue
	 * reached the file; the writer reports that separately through
	 * {@link InputQueueCoordinator.resolveSnapshotWrite}.
	 */
	persistQueue(): Promise<void>
	/** Publish the queue projection to the webview. */
	publishProjection(): Promise<void>
	/**
	 * Answer the waiting turn-end interaction with a claimed batch.
	 *
	 * @returns whether the response was accepted. A rejection means the user
	 * answered first, so the batch was never delivered.
	 */
	answerTurnEnd(delivery: QueueDelivery): Promise<boolean>
	/**
	 * Add a claimed batch to the request being assembled.
	 *
	 * Throwing must leave the request unchanged, otherwise the entry would ride
	 * along with this round and return to the queue to be sent again.
	 */
	stageToolRoundInput(delivery: QueueDelivery): Promise<void>
	/** Record the user-visible form only after a staged delivery became durable. */
	presentDeliveredInput(delivery: QueueDelivery): Promise<void>
}

/**
 * Owns the retained input queue and every rule that keeps it consistent.
 *
 * These pieces were previously six separate fields on the task, held together
 * by comments and call discipline. They are one state machine: a claim is only
 * safe once its in-flight mark is durable, a rollback is only safe while no
 * delivery can interleave, and a write ticket only describes the transaction
 * that created it. Keeping them in one object is what makes those rules
 * enforceable rather than merely documented.
 */
export class InputQueueCoordinator {
	private readonly queue = new InputQueue()
	/**
	 * Serializes every read-modify-write over the queue.
	 *
	 * User changes and deliveries each await a disk write in the middle of
	 * their work, and that await lets the other one interleave. Without this a
	 * failed mutation could roll back over a claim a delivery completed
	 * meanwhile.
	 */
	private readonly gate = new InputQueueGate()
	/**
	 * The queue as the last completed transaction left it.
	 *
	 * Snapshot writes triggered by unrelated runtime activity read this rather
	 * than the live queue, so they can never capture a state a gate section is
	 * still deciding whether to keep.
	 *
	 * Undefined until the queue has been loaded or first written. That is not
	 * the same as an empty queue: a snapshot written before the file has been
	 * read must leave whatever it holds alone.
	 */
	private committed?: QueuedInputEntry[]
	/**
	 * The queue change currently on its way to disk, if one is.
	 *
	 * It carries both the queue being submitted and the intent behind it, and
	 * is discarded once the write settles. Keeping the intent here rather than
	 * on a long-lived field is what stops a failed removal from leaving
	 * `user_removal` behind for an unrelated later write to use as permission
	 * to replace a queue this session never read.
	 */
	private pendingWrite?: InputQueueWriteTicket
	/**
	 * Set when the snapshot file exists but could not be read.
	 *
	 * What it holds for the queue is then unknown, so writes reuse whatever is
	 * on disk instead of replacing it.
	 */
	private readFailed = false
	/**
	 * A tool-round batch that has been staged into the request but not sent.
	 *
	 * Appending only stages the input; it is settled once the request has
	 * actually entered the durable conversation.
	 */
	private staged?: QueueDelivery

	constructor(private readonly host: InputQueueHost) {}

	/** The queue as the user should see it; in-flight entries stay hidden. */
	snapshot(): QueuedInputEntry[] {
		return [...this.queue.list()]
	}

	/** The queue as it should be written, including in-flight entries. */
	serialize(): QueuedInputEntry[] {
		return this.queue.serialize()
	}

	/** How many entries the last load discarded because they were in flight. */
	get droppedInFlightCount(): number {
		return this.queue.droppedInFlightCount
	}

	/**
	 * Run a section that reads and writes the queue.
	 *
	 * Exposed for loading, which has to read a file between clearing the queue
	 * and repopulating it. The gate itself stays private: it is a plain
	 * serializer, not a reentrant lock, so a section must never take it again.
	 */
	runExclusive<T>(section: () => Promise<T>): Promise<T> {
		return this.gate.run(section)
	}

	/**
	 * Adopt the queue found in a snapshot.
	 *
	 * The existing queue is reset rather than replaced: swapping the instance
	 * would strand any delivery holding the old one, letting its entry be
	 * claimed and sent twice.
	 */
	adoptPersisted(entries: unknown): void {
		this.queue.resetFrom(entries)
		this.committed = this.queue.serialize()
		this.readFailed = false
	}

	/**
	 * Record that the snapshot file is absent.
	 *
	 * There is no retained input to protect, and publishing the projection lets
	 * ordinary writes proceed instead of leaving every later snapshot unable to
	 * record the queue.
	 */
	markQueueAbsent(): void {
		this.committed = this.queue.serialize()
		this.readFailed = false
	}

	/**
	 * Record that the file is there but unreadable.
	 *
	 * Writes are then blocked from touching the queue field until a user
	 * removal makes a new one authoritative; otherwise a resume would rewrite
	 * the file without input it may still contain.
	 */
	markQueueUnreadable(): void {
		this.readFailed = true
	}

	/**
	 * Decide what a snapshot write should record for the queue.
	 *
	 * Must be called before the writer's first await: a write that yields first
	 * could otherwise pick up a projection published by a transaction that has
	 * not finished, and a later rollback could not take it back off disk.
	 */
	resolveSnapshotWrite(persisted: QueuedInputEntry[] | undefined): InputQueueWriteDecision {
		const ticket = this.pendingWrite
		return resolveInputQueueWrite({
			// A ticket means this write was requested by a queue transaction and
			// carries its queue; otherwise this is unrelated runtime activity
			// and the last committed projection is what belongs on disk.
			committed: ticket?.entries ?? this.committed,
			persisted,
			readFailed: this.readFailed,
			// Only the change that asked for this write may claim removal
			// intent. Runtime writes are always ordinary, so a removal cannot
			// leak into one and license replacing a queue nobody read.
			intent: ticket?.intent ?? "ordinary",
		})
	}

	/** Report what the writer did with the queue this write was given. */
	recordSnapshotWriteOutcome(outcome: InputQueueWriteOutcome): void {
		if (this.pendingWrite) {
			recordInputQueueWriteOutcome(this.pendingWrite, outcome)
		}
	}

	/**
	 * Apply a user's change and report whether it survived to disk.
	 *
	 * The whole transaction runs in one section so a delivery cannot claim an
	 * entry between the checkpoint and a rollback and have its claim erased.
	 */
	async mutate(mutation: InputQueueMutation): Promise<InputQueueMutationResult> {
		return this.gate.run(async () => {
			// Taken before the change so a failed write can put the queue back
			// to what the file still says. Publishing a change that is not on
			// disk would be a lie the next reload contradicts, and for a removal
			// it would be worse: the entry would come back and could still be
			// sent.
			const checkpoint = this.queue.checkpoint()
			const result = applyInputQueueMutation(this.queue, mutation)
			if (!result.accepted) {
				return result
			}
			// A removal is the one change that may replace a queue this session
			// could not read: the user is discarding input on purpose.
			const intent: InputQueueWriteIntent = mutation.remove ? "user_removal" : "ordinary"
			if (!(await this.persist(intent))) {
				this.queue.rollback(checkpoint)
				await this.host.publishProjection()
				return { accepted: false, result: "persist_failed" }
			}
			await this.host.publishProjection()
			return result
		})
	}

	/**
	 * Deliver retained input to a turn-end interaction that is waiting.
	 *
	 * The interaction is durable and its waiter is installed by the time this
	 * runs, so retained input can answer it as an ordinary user response.
	 */
	async deliverAtTurnEnd(): Promise<void> {
		const delivery = await this.claim("turn-end")
		if (!delivery) {
			return
		}
		try {
			if (!(await this.host.answerTurnEnd(delivery))) {
				// The user answered first, so the entry was never delivered. Put
				// it back, otherwise the composer would keep showing the
				// projection taken while the entry was momentarily claimed.
				await this.release(delivery)
				Logger.warn("[inputQueue] Turn-end delivery rejected")
				return
			}
		} catch (error) {
			await this.release(delivery)
			Logger.error("[inputQueue] Turn-end delivery failed:", error)
			return
		}
		// Only now is the input actually gone from the user's queue; discarding
		// it before the dispatch was accepted would lose it on a rejection.
		await this.commit(delivery)
	}

	/**
	 * Append any steering input owed to the round that is about to start.
	 *
	 * The batch is retained rather than committed here: appending only stages
	 * the input, and the request that carries it has not been sent yet.
	 */
	async deliverAtToolRound(): Promise<void> {
		const delivery = await this.claim("tool-round")
		if (!delivery) {
			return
		}
		try {
			await this.host.stageToolRoundInput(delivery)
		} catch (error) {
			await this.release(delivery)
			Logger.error("[inputQueue] Tool-round delivery failed:", error)
			return
		}
		this.staged = delivery
		// Publish now so the composer stops offering an entry that is already
		// staged, but keep the claim open until the round settles.
		await this.host.publishProjection()
	}

	/**
	 * Settle the staged tool-round batch once its fate is known.
	 *
	 * @param delivered whether the input reached the durable conversation. A
	 * round that ended before sending never delivered it, so the input returns
	 * to the queue instead of being silently consumed.
	 */
	async settleStagedDelivery(delivered: boolean): Promise<void> {
		const delivery = this.staged
		if (!delivery) {
			return
		}
		this.staged = undefined
		if (!delivered) {
			await this.release(delivery)
			return
		}
		try {
			await this.host.presentDeliveredInput(delivery)
		} catch (error) {
			// The API conversation is already durable. Presentation failure must
			// not return or strand input that has reached the model.
			Logger.error("[inputQueue] Delivered input could not be added to UI history:", error)
		}
		await this.commit(delivery)
	}

	/** Whether a tool-round batch is currently staged in the request. */
	get hasStagedDelivery(): boolean {
		return this.staged !== undefined
	}

	/**
	 * Take the batch owed to a delivery point and make its claim durable.
	 *
	 * Claiming and recording the claim run as one section: a user change
	 * arriving in between could otherwise be rolled back over this claim.
	 */
	private async claim(point: "turn-end" | "tool-round"): Promise<QueueDelivery | undefined> {
		const claimed = await this.gate.run(async () => {
			const batch = takeQueueDelivery(this.queue, point)
			if (!batch) {
				return undefined
			}
			// Record the in-flight mark before handing anything over. A crash
			// after this point must not restore the entry as deliverable,
			// because the model may already have received it. If that record
			// cannot be written, delivering anyway would forfeit at-most-once:
			// a later crash would resend the entry. Keeping it queued is the
			// recoverable outcome.
			if (!(await this.persist("ordinary"))) {
				Logger.error(`[inputQueue] ${point} delivery skipped: the in-flight mark could not be persisted`)
				await this.releaseLocked(batch)
				return undefined
			}
			return batch
		})
		if (!claimed) {
			await this.host.publishProjection()
			return undefined
		}
		// Removals that queued behind the claim run here, between the two
		// sections. Checking inside the claim would look before they can land,
		// which is why this is a section of its own: it is the last moment the
		// user's removal can still stop the send.
		const live = await this.gate.run(async () => claimed.withoutCancelled())
		if (!live) {
			await this.host.publishProjection()
			return undefined
		}
		return live
	}

	/** Drop a batch whose delivery is known to have landed. */
	private async commit(delivery: QueueDelivery): Promise<void> {
		await this.gate.run(async () => {
			delivery.commit()
			if (!(await this.persist("ordinary"))) {
				// The entry stays on disk marked as in flight. A reload drops it
				// rather than sending it again, which is the safe direction.
				Logger.error("[inputQueue] Delivered input could not be cleared from the queue file")
			}
		})
	}

	/** Return a claimed batch to the queue and republish the projection. */
	private async release(delivery: QueueDelivery): Promise<void> {
		await this.gate.run(() => this.releaseLocked(delivery))
	}

	/**
	 * The body of {@link release}, for callers already inside the gate. Taking
	 * the gate again there would deadlock: it is a plain serializer, not a
	 * reentrant lock.
	 */
	private async releaseLocked(delivery: QueueDelivery): Promise<void> {
		delivery.restore()
		if (!(await this.persist("ordinary"))) {
			// The entry is back in memory but the file still marks it in
			// flight, so a reload would drop it. Showing it in the composer as
			// if it were safely back would be a promise this task cannot keep,
			// so the claim is left in place instead: the entry stays hidden and
			// its fate stays consistent with what is on disk.
			delivery.reclaim()
			Logger.error("[inputQueue] Restored input could not be persisted; it stays withheld to match the file")
		}
		await this.host.publishProjection()
	}

	/**
	 * Write the current queue and report whether it is now on disk.
	 *
	 * Callers are all inside the gate, so what the ticket captures is a whole
	 * transaction rather than half of one, and nothing of this change survives
	 * to influence a later unrelated write.
	 */
	private async persist(intent: InputQueueWriteIntent): Promise<boolean> {
		const ticket = createInputQueueWriteTicket(this.queue.serialize(), intent)
		this.pendingWrite = ticket
		try {
			await this.host.persistQueue()
			if (!inputQueueWriteSucceeded(ticket)) {
				// The writer ran but kept the queue already on disk, so this
				// change is not there. Reporting success would let a delivery
				// send an entry whose in-flight mark was never recorded.
				Logger.error(`[inputQueue] The queue was not written (${ticket.outcome})`)
				return false
			}
			// Only a queue that reached the file becomes the projection later
			// runtime writes reuse; promoting it earlier would let an unrelated
			// write put back a state this transaction is about to roll back.
			this.committed = [...ticket.entries]
			return true
		} catch (error) {
			Logger.error("[inputQueue] Failed to persist the input queue:", error)
			return false
		} finally {
			// The ticket covers this write only. Leaving it in place would let
			// the next runtime snapshot write out a queue, and an intent, that
			// belonged to a transaction that has already finished.
			this.pendingWrite = undefined
		}
	}
}
