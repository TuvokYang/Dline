import { describe, expect, it } from "vitest"
import { InputQueue } from "./InputQueue"
import { takeQueueDelivery } from "./InputQueueDelivery"
import { InputQueueGate } from "./InputQueueGate"

/** A promise whose settlement this test controls, standing in for a disk write. */
function deferred<T = void>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

const draft = (text: string) => ({ text, images: [], files: [] })

describe("InputQueueGate", () => {
	it("holds a section back until the one before it settles", async () => {
		const gate = new InputQueueGate()
		const first = deferred()
		const order: string[] = []

		const firstRun = gate.run(async () => {
			order.push("first:enter")
			await first.promise
			order.push("first:exit")
		})
		const secondRun = gate.run(async () => {
			order.push("second:enter")
		})

		// Give the microtask queue every chance to let the second section in.
		for (let tick = 0; tick < 5; tick++) {
			await Promise.resolve()
		}
		expect(order).toEqual(["first:enter"])

		first.resolve()
		await Promise.all([firstRun, secondRun])
		expect(order).toEqual(["first:enter", "first:exit", "second:enter"])
	})

	it("keeps running sections after one of them rejects", async () => {
		const gate = new InputQueueGate()

		const failed = gate.run(async () => {
			throw new Error("write failed")
		})
		await expect(failed).rejects.toThrow("write failed")

		await expect(gate.run(async () => "next")).resolves.toBe("next")
	})

	it("propagates the section result to its own caller only", async () => {
		const gate = new InputQueueGate()
		const results = await Promise.all([gate.run(async () => 1), gate.run(async () => 2)])
		expect(results).toEqual([1, 2])
	})
})

describe("InputQueueGate protecting the queue", () => {
	/**
	 * The unguarded interleaving this gate exists to prevent. Kept as an
	 * executable statement of the bug: a rollback taken before a claim undoes
	 * that claim, making an in-flight entry visible and claimable again.
	 */
	it("shows an unguarded rollback undoing a concurrent claim", async () => {
		const queue = new InputQueue()
		queue.enqueue(draft("hello"))
		const write = deferred()

		// Mutation path: checkpoint, mutate, then await its write.
		const checkpoint = queue.checkpoint()
		queue.enqueue(draft("second"))
		const mutation = write.promise.then(() => {
			// The write failed, so the mutation undoes its own work.
			queue.rollback(checkpoint)
		})

		// Delivery path interleaves during that await and claims the entry.
		const claimed = queue.takeNextQueued()
		expect(claimed?.text).toBe("hello")
		// The claimed entry is hidden; only the uncommitted "second" remains.
		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])

		write.resolve()
		await mutation

		// The claim is gone: the same entry is visible and claimable again,
		// while the delivery still holds its copy. That is the double send.
		expect(queue.list().map((entry) => entry.text)).toEqual(["hello"])
		expect(queue.takeNextQueued()?.text).toBe("hello")
	})

	/**
	 * The second interleaving found in review: a mutation checkpoints while an
	 * entry is claimed, the delivery fails and releases the claim outside the
	 * gate, then the mutation rolls back over that release. The entry ends up
	 * claimed with nothing left to settle it, so the user can never see it and
	 * a reload drops it for still carrying the delivering mark.
	 */
	it("shows an unguarded release being undone by a later rollback", async () => {
		const queue = new InputQueue()
		const id = queue.enqueue(draft("hello"))
		const write = deferred()

		// Delivery claims the entry, then hands control back.
		const claimed = queue.takeNextQueued()
		expect(claimed?.id).toBe(id)

		// Mutation checkpoints while the claim is open and awaits its write.
		const checkpoint = queue.checkpoint()
		const mutation = write.promise.then(() => queue.rollback(checkpoint))

		// The delivery fails and releases the claim during that await.
		queue.releaseClaim([id as string])
		expect(queue.list()).toHaveLength(1)
		expect(queue.serialize()[0].delivering).toBe(false)

		write.resolve()
		await mutation

		// The release is undone: claimed again, invisible, and marked in flight.
		expect(queue.list()).toHaveLength(0)
		expect(queue.serialize()[0].delivering).toBe(true)
	})

	it("keeps a release intact when both paths go through the gate", async () => {
		const gate = new InputQueueGate()
		const queue = new InputQueue()
		const id = queue.enqueue(draft("hello")) as string
		const write = deferred()

		const claimed = queue.takeNextQueued()
		expect(claimed?.id).toBe(id)

		const mutation = gate.run(async () => {
			const checkpoint = queue.checkpoint()
			await write.promise
			queue.rollback(checkpoint)
		})
		const release = gate.run(async () => {
			queue.releaseClaim([id])
		})

		for (let tick = 0; tick < 5; tick++) {
			await Promise.resolve()
		}
		// The release is still waiting, so the rollback cannot precede it.
		expect(queue.list()).toHaveLength(0)

		write.resolve()
		await Promise.all([mutation, release])

		expect(queue.list().map((entry) => entry.text)).toEqual(["hello"])
		expect(queue.serialize()[0].delivering).toBe(false)
	})

	/**
	 * A reload can reach a running task, so it must not swap the queue object
	 * out from under a delivery that is still settling.
	 */
	it("keeps a delivery bound to the queue a reload restores into", () => {
		const queue = new InputQueue()
		queue.enqueue(draft("in flight"))
		const delivery = takeQueueDelivery(queue, "turn-end")
		expect(delivery).toBeDefined()

		// The reload brings back a different entry set while the claim is open.
		queue.resetFrom([{ id: "restored", text: "restored", images: [], files: [], mode: "queued", sequence: 0 }])
		// Settling the old claim must not resurrect anything or throw.
		delivery?.restore()

		// Only the restored entry is present: the claimed one was replaced by
		// the reload, and releasing its claim cannot bring it back.
		expect(queue.list().map((entry) => entry.text)).toEqual(["restored"])
	})

	it("drops in-flight entries when resetting in place, like a fresh load", () => {
		const queue = new InputQueue()
		queue.enqueue(draft("stale"))
		queue.resetFrom([
			{ id: "a", text: "sent?", images: [], files: [], mode: "queued", sequence: 0, delivering: true },
			{ id: "b", text: "safe", images: [], files: [], mode: "queued", sequence: 1 },
		])

		expect(queue.list().map((entry) => entry.text)).toEqual(["safe"])
		expect(queue.droppedInFlightCount).toBe(1)
	})

	it("lets a queued removal land between the claim and the send check", async () => {
		const gate = new InputQueueGate()
		const queue = new InputQueue()
		const id = queue.enqueue(draft("cancel me")) as string
		const write = deferred()

		// Claim section: takes the entry and awaits its in-flight write.
		let claimed: ReturnType<typeof takeQueueDelivery>
		const claim = gate.run(async () => {
			claimed = takeQueueDelivery(queue, "turn-end")
			await write.promise
			return claimed
		})
		// The user's removal queues behind the claim section.
		const removal = gate.run(async () => {
			queue.remove(id)
		})

		write.resolve()
		await Promise.all([claim, removal])

		// The cancellation check runs as its own section, after the removal.
		const live = await gate.run(async () => claimed?.withoutCancelled())
		expect(live).toBeUndefined()
	})

	it("keeps a claim intact when both paths go through the gate", async () => {
		const gate = new InputQueueGate()
		const queue = new InputQueue()
		queue.enqueue(draft("hello"))
		const write = deferred()

		const mutation = gate.run(async () => {
			const checkpoint = queue.checkpoint()
			queue.enqueue(draft("second"))
			await write.promise
			queue.rollback(checkpoint)
		})

		let claimed: ReturnType<InputQueue["takeNextQueued"]>
		const delivery = gate.run(async () => {
			claimed = queue.takeNextQueued()
		})

		// The delivery cannot start while the mutation still holds the gate.
		for (let tick = 0; tick < 5; tick++) {
			await Promise.resolve()
		}
		expect(claimed).toBeUndefined()

		write.resolve()
		await Promise.all([mutation, delivery])

		expect(claimed?.text).toBe("hello")
		// The rollback ran before the claim, so it cannot have erased it.
		expect(queue.list()).toHaveLength(0)
		expect(queue.takeNextQueued()).toBeUndefined()
	})
})
