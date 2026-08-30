import type { QueuedInputEntry } from "@shared/InputQueue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InputQueueCoordinator, type InputQueueHost } from "./InputQueueCoordinator"
import type { QueueDelivery } from "./InputQueueDelivery"

vi.mock("@shared/services/Logger", () => ({
	Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

/**
 * A stand-in for the task's snapshot writer.
 *
 * It goes through the same two calls the real writer makes — asking what to
 * record and reporting what it did — because the coordinator only treats a
 * change as durable when that report says `written`. A double that merely
 * resolves would leave every ticket pending and hide exactly the failures
 * these tests exist to cover.
 */
class FakeSnapshotWriter {
	/** What the queue file currently holds. */
	disk?: QueuedInputEntry[]
	/** When set, the next write fails this way instead of succeeding. */
	nextOutcome?: "preserved" | "failed"
	/** When true, the write rejects before reaching the file at all. */
	rejectNext = false
	/** Runs inside a write, to interleave a change with an in-flight claim. */
	onWrite?: () => void
	writes = 0

	constructor(private readonly coordinator: () => InputQueueCoordinator) {}

	async write(): Promise<void> {
		this.writes += 1
		this.onWrite?.()
		if (this.rejectNext) {
			this.rejectNext = false
			throw new Error("disk unavailable")
		}
		const decision = this.coordinator().resolveSnapshotWrite(this.disk)
		const outcome = this.nextOutcome
		this.nextOutcome = undefined
		if (outcome) {
			this.coordinator().recordSnapshotWriteOutcome(outcome)
			return
		}
		if (decision.kind === "write") {
			this.disk = decision.entries ? [...decision.entries] : undefined
			this.coordinator().recordSnapshotWriteOutcome("written")
			return
		}
		this.coordinator().recordSnapshotWriteOutcome("preserved")
	}
}

interface Harness {
	coordinator: InputQueueCoordinator
	writer: FakeSnapshotWriter
	host: {
		publishProjection: ReturnType<typeof vi.fn>
		answerTurnEnd: ReturnType<typeof vi.fn>
		stageToolRoundInput: ReturnType<typeof vi.fn>
		presentDeliveredInput: ReturnType<typeof vi.fn>
	}
}

function harness(): Harness {
	let coordinator!: InputQueueCoordinator
	const writer = new FakeSnapshotWriter(() => coordinator)
	const host = {
		publishProjection: vi.fn(async () => undefined),
		answerTurnEnd: vi.fn(async (_delivery: QueueDelivery) => true),
		stageToolRoundInput: vi.fn(async (_delivery: QueueDelivery) => undefined),
		presentDeliveredInput: vi.fn(async (_delivery: QueueDelivery) => undefined),
	}
	const port: InputQueueHost = {
		persistQueue: () => writer.write(),
		publishProjection: host.publishProjection,
		answerTurnEnd: host.answerTurnEnd,
		stageToolRoundInput: host.stageToolRoundInput,
		presentDeliveredInput: host.presentDeliveredInput,
	}
	coordinator = new InputQueueCoordinator(port)
	// Start from a task whose snapshot has been read, which is what every
	// delivery path assumes; without it a write has no queue to replace.
	coordinator.adoptPersisted([])
	return { coordinator, writer, host }
}

async function enqueue(coordinator: InputQueueCoordinator, text: string): Promise<string> {
	const result = await coordinator.mutate({ enqueue: { draft: { text } } })
	if (!result.accepted) {
		throw new Error(`enqueue rejected: ${result.result}`)
	}
	return result.result
}

const texts = (entries: readonly QueuedInputEntry[]): string[] => entries.map((entry) => entry.text)

describe("InputQueueCoordinator", () => {
	let h: Harness

	beforeEach(() => {
		h = harness()
	})

	describe("user changes", () => {
		it("keeps a change only when the writer reports it reached the file", async () => {
			await enqueue(h.coordinator, "kept")

			expect(texts(h.coordinator.snapshot())).toEqual(["kept"])
			expect(texts(h.writer.disk ?? [])).toEqual(["kept"])
		})

		it("rolls the queue back when the write rejects", async () => {
			await enqueue(h.coordinator, "first")
			h.writer.rejectNext = true

			const result = await h.coordinator.mutate({ enqueue: { draft: { text: "lost" } } })

			expect(result).toEqual({ accepted: false, result: "persist_failed" })
			expect(texts(h.coordinator.snapshot())).toEqual(["first"])
		})

		it("rolls the queue back when the writer preserved the file instead of writing", async () => {
			await enqueue(h.coordinator, "first")
			h.writer.nextOutcome = "preserved"

			const result = await h.coordinator.mutate({ enqueue: { draft: { text: "not on disk" } } })

			// Preserving means the change never reached the file, so showing it
			// would be contradicted by the next reload.
			expect(result).toEqual({ accepted: false, result: "persist_failed" })
			expect(texts(h.coordinator.snapshot())).toEqual(["first"])
		})

		it("restores a removed entry when its removal could not be persisted", async () => {
			const id = await enqueue(h.coordinator, "keep me")
			h.writer.nextOutcome = "failed"

			const result = await h.coordinator.mutate({ remove: { entryId: id } })

			expect(result.accepted).toBe(false)
			// A removal that is reported as done but not written would come back
			// on reload and could still be delivered.
			expect(texts(h.coordinator.snapshot())).toEqual(["keep me"])
		})
	})

	describe("turn-end delivery", () => {
		it("hands the batch over and drops it once the turn accepted it", async () => {
			await enqueue(h.coordinator, "queued work")

			await h.coordinator.deliverAtTurnEnd()

			expect(h.host.answerTurnEnd).toHaveBeenCalledTimes(1)
			expect(h.coordinator.snapshot()).toEqual([])
			expect(h.writer.disk).toEqual([])
		})

		it("returns the batch when the turn was already answered", async () => {
			await enqueue(h.coordinator, "queued work")
			h.host.answerTurnEnd.mockResolvedValueOnce(false)

			await h.coordinator.deliverAtTurnEnd()

			expect(texts(h.coordinator.snapshot())).toEqual(["queued work"])
		})

		it("returns the batch when handing it over threw", async () => {
			await enqueue(h.coordinator, "queued work")
			h.host.answerTurnEnd.mockRejectedValueOnce(new Error("dispatch exploded"))

			await h.coordinator.deliverAtTurnEnd()

			expect(texts(h.coordinator.snapshot())).toEqual(["queued work"])
		})

		it("does not deliver when the in-flight mark could not be persisted", async () => {
			await enqueue(h.coordinator, "queued work")
			h.writer.nextOutcome = "failed"

			await h.coordinator.deliverAtTurnEnd()

			// Sending without a durable mark would forfeit at-most-once: a crash
			// afterwards would offer the same entry again.
			expect(h.host.answerTurnEnd).not.toHaveBeenCalled()
		})

		it("withholds a restored entry whose restore could not be persisted", async () => {
			await enqueue(h.coordinator, "queued work")
			h.host.answerTurnEnd.mockImplementationOnce(async () => {
				// Fail the write that the release will attempt.
				h.writer.nextOutcome = "failed"
				return false
			})

			await h.coordinator.deliverAtTurnEnd()

			// The file still marks it in flight, so presenting it as safely back
			// would be a promise the next reload breaks.
			expect(h.coordinator.snapshot()).toEqual([])
		})
	})

	describe("tool-round delivery", () => {
		async function steer(text: string): Promise<string> {
			const id = await enqueue(h.coordinator, text)
			const toggled = await h.coordinator.mutate({ toggleMode: { entryId: id } })
			expect(toggled).toEqual({ accepted: true, result: "steering" })
			return id
		}

		it("keeps the claim open until the round settles", async () => {
			await steer("steer me")

			await h.coordinator.deliverAtToolRound()

			expect(h.host.stageToolRoundInput).toHaveBeenCalledTimes(1)
			expect(h.coordinator.hasStagedDelivery).toBe(true)
			// Staged input is hidden but not yet discarded: the request carrying
			// it has not been sent.
			expect(h.coordinator.snapshot()).toEqual([])
		})

		it("drops the batch once the request reached the conversation", async () => {
			await steer("steer me")
			await h.coordinator.deliverAtToolRound()

			await h.coordinator.settleStagedDelivery(true)

			expect(h.coordinator.hasStagedDelivery).toBe(false)
			expect(h.coordinator.snapshot()).toEqual([])
			expect(h.writer.disk).toEqual([])
			expect(h.host.presentDeliveredInput).toHaveBeenCalledOnce()
			expect(h.host.presentDeliveredInput.mock.calls[0][0].entries.map((entry: QueuedInputEntry) => entry.text)).toEqual([
				"steer me",
			])
		})

		it("returns the batch when the round ended without sending it", async () => {
			await steer("steer me")
			await h.coordinator.deliverAtToolRound()

			await h.coordinator.settleStagedDelivery(false)

			expect(texts(h.coordinator.snapshot())).toEqual(["steer me"])
			expect(h.host.presentDeliveredInput).not.toHaveBeenCalled()
		})

		it("still commits a delivered batch when its UI presentation fails", async () => {
			await steer("steer me")
			await h.coordinator.deliverAtToolRound()
			h.host.presentDeliveredInput.mockRejectedValueOnce(new Error("ui history unavailable"))

			await h.coordinator.settleStagedDelivery(true)

			expect(h.coordinator.snapshot()).toEqual([])
			expect(h.writer.disk).toEqual([])
		})

		it("returns the batch when staging threw", async () => {
			await steer("steer me")
			h.host.stageToolRoundInput.mockRejectedValueOnce(new Error("append failed"))

			await h.coordinator.deliverAtToolRound()

			expect(h.coordinator.hasStagedDelivery).toBe(false)
			expect(texts(h.coordinator.snapshot())).toEqual(["steer me"])
		})

		// Publishing costs a full ExtensionState build, and an empty queue means
		// nothing changed for the composer to catch up on. Doing it on every
		// delivery point burned that build for no observable difference.
		it("does not republish when there was nothing to claim", async () => {
			await h.coordinator.deliverAtToolRound()
			await h.coordinator.deliverAtTurnEnd()

			expect(h.host.publishProjection).not.toHaveBeenCalled()
		})

		// The entry was hidden by the claim and then put back, so the composer is
		// showing a projection that no longer matches. Unlike an empty queue,
		// this one has to be corrected.
		it("republishes when a claim was taken and then given back", async () => {
			const id = await enqueue(h.coordinator, "steer me")
			await h.coordinator.mutate({ toggleMode: { entryId: id } })
			// Fails the write that records the in-flight mark, so the claim is
			// released instead of delivered.
			h.writer.nextOutcome = "failed"
			h.host.publishProjection.mockClear()

			await h.coordinator.deliverAtToolRound()

			expect(h.host.stageToolRoundInput).not.toHaveBeenCalled()
			expect(h.host.publishProjection).toHaveBeenCalled()
		})

		it("leaves plain queued input for the turn end", async () => {
			await enqueue(h.coordinator, "queued work")

			await h.coordinator.deliverAtToolRound()

			expect(h.host.stageToolRoundInput).not.toHaveBeenCalled()
			expect(texts(h.coordinator.snapshot())).toEqual(["queued work"])
		})
	})

	describe("write tickets", () => {
		it("does not let a delivery's write carry a removal's intent", async () => {
			const id = await enqueue(h.coordinator, "gone")
			await h.coordinator.mutate({ remove: { entryId: id } })
			await enqueue(h.coordinator, "queued work")
			// The file became unreadable after those changes.
			h.coordinator.markQueueUnreadable()

			await h.coordinator.deliverAtTurnEnd()

			// An ordinary write must not replace a queue this session cannot
			// read, no matter what the previous transaction was allowed to do.
			expect(h.host.answerTurnEnd).not.toHaveBeenCalled()
		})

		it("writes the last committed queue for snapshots it did not request", async () => {
			await enqueue(h.coordinator, "kept")

			// A runtime snapshot write, with no queue transaction behind it.
			const decision = h.coordinator.resolveSnapshotWrite(undefined)

			expect(decision.kind).toBe("write")
			expect(decision.kind === "write" ? texts(decision.entries ?? []) : []).toEqual(["kept"])
		})
	})

	describe("loading", () => {
		it("adopts a persisted queue and drops entries left in flight", () => {
			const { coordinator } = harness()

			coordinator.adoptPersisted([
				{ id: "a", text: "safe", images: [], files: [], mode: "queued", sequence: 0 },
				{ id: "b", text: "was sending", images: [], files: [], mode: "queued", sequence: 1, delivering: true },
			])

			// The model may already have received the in-flight one, so offering
			// it again would risk repeating an instruction.
			expect(texts(coordinator.snapshot())).toEqual(["safe"])
			expect(coordinator.droppedInFlightCount).toBe(1)
		})

		it("refuses to replace a queue it could not read", async () => {
			const { coordinator, writer } = harness()
			writer.disk = [{ id: "a", text: "on disk", images: [], files: [], mode: "queued", sequence: 0 }]
			coordinator.markQueueUnreadable()

			const result = await coordinator.mutate({ enqueue: { draft: { text: "new" } } })

			expect(result).toEqual({ accepted: false, result: "persist_failed" })
			expect(texts(writer.disk)).toEqual(["on disk"])
		})
	})
})
