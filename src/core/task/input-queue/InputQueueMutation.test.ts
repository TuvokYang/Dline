import { describe, expect, it } from "vitest"
import { InputQueue } from "./InputQueue"
import { applyInputQueueMutation } from "./InputQueueMutation"

function draft(text: string) {
	return { text, images: [], files: [] }
}

function seeded(texts: string[]): InputQueue {
	const queue = new InputQueue()
	for (const text of texts) {
		queue.enqueue(draft(text))
	}
	return queue
}

describe("applyInputQueueMutation", () => {
	it("rejects a request that carries no operation", () => {
		const queue = new InputQueue()

		const result = applyInputQueueMutation(queue, {})

		expect(result).toEqual({ accepted: false, result: "missing_operation" })
	})

	// A user request is asynchronous, so it can arrive after the entry was
	// claimed for delivery. Reporting success would be a lie: the content sent
	// to the model is fixed, and the change would vanish on commit.
	it("reports an in-flight entry as missing rather than mutating it", () => {
		const queue = seeded(["first", "second"])
		const claimed = queue.takeNextQueued()
		const id = claimed?.id ?? ""
		expect(id).not.toBe("")

		expect(applyInputQueueMutation(queue, { toggleMode: { entryId: id } })).toEqual({
			accepted: false,
			result: "missing_entry",
		})
		expect(applyInputQueueMutation(queue, { beginEdit: { entryId: id } })).toEqual({
			accepted: false,
			result: "missing_entry",
		})
		expect(applyInputQueueMutation(queue, { commitEdit: { entryId: id, draft: draft("rewritten") } })).toEqual({
			accepted: false,
			result: "missing_entry",
		})
		expect(applyInputQueueMutation(queue, { cancelEdit: { entryId: id } })).toEqual({
			accepted: false,
			result: "missing_entry",
		})

		queue.releaseClaim([id])
		expect(queue.get(id)?.text).toBe("first")
	})

	// Removal is the user stating they no longer want the input at all, which
	// outranks a delivery that has not settled.
	it("still removes an in-flight entry on the user's request", () => {
		const queue = seeded(["first", "second"])
		const claimed = queue.takeNextQueued()
		const id = claimed?.id ?? ""

		expect(applyInputQueueMutation(queue, { remove: { entryId: id } })).toEqual({ accepted: true, result: "ok" })

		queue.releaseClaim([id])
		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])
	})

	it("enqueues a draft and reports the new entry id", () => {
		const queue = new InputQueue()

		const result = applyInputQueueMutation(queue, { enqueue: { draft: draft("queue me") } })

		expect(result.accepted).toBe(true)
		expect(queue.list().map((entry) => entry.text)).toEqual(["queue me"])
		expect(result.result).toBe(queue.list()[0]?.id)
	})

	it("refuses to enqueue past the limit instead of evicting", () => {
		const queue = new InputQueue()
		for (let index = 0; index < 32; index++) {
			queue.enqueue(draft(`entry-${index}`))
		}

		const result = applyInputQueueMutation(queue, { enqueue: { draft: draft("overflow") } })

		expect(result).toEqual({ accepted: false, result: "queue_full" })
		expect(queue.size).toBe(32)
	})

	it("toggles an entry between queued and steering without delivering it", () => {
		const queue = seeded(["one"])
		const id = queue.list()[0].id

		const promoted = applyInputQueueMutation(queue, { toggleMode: { entryId: id } })
		expect(promoted).toEqual({ accepted: true, result: "steering" })
		expect(queue.size).toBe(1)

		const demoted = applyInputQueueMutation(queue, { toggleMode: { entryId: id } })
		expect(demoted).toEqual({ accepted: true, result: "queued" })
	})

	it("reorders an entry to an explicit position", () => {
		const queue = seeded(["a", "b", "c"])
		const id = queue.list()[2].id

		const result = applyInputQueueMutation(queue, { reorder: { entryId: id, targetIndex: 0 } })

		expect(result.accepted).toBe(true)
		expect(queue.list().map((entry) => entry.text)).toEqual(["c", "a", "b"])
	})

	it("gates an entry while it is being edited and releases it on commit", () => {
		const queue = seeded(["before"])
		const id = queue.list()[0].id

		expect(applyInputQueueMutation(queue, { beginEdit: { entryId: id } }).accepted).toBe(true)
		expect(queue.takeNextQueued()).toBeUndefined()

		const committed = applyInputQueueMutation(queue, {
			commitEdit: { entryId: id, draft: draft("after") },
		})

		expect(committed.accepted).toBe(true)
		expect(queue.takeNextQueued()?.text).toBe("after")
	})

	it("releases the edit gate without changing the entry when the edit is cancelled", () => {
		const queue = seeded(["kept"])
		const id = queue.list()[0].id
		applyInputQueueMutation(queue, { beginEdit: { entryId: id } })

		const result = applyInputQueueMutation(queue, { cancelEdit: { entryId: id } })

		expect(result.accepted).toBe(true)
		expect(queue.takeNextQueued()?.text).toBe("kept")
	})

	it("removes an entry, which is the only way it leaves the queue unsent", () => {
		const queue = seeded(["keep", "drop"])
		const id = queue.list()[1].id

		const result = applyInputQueueMutation(queue, { remove: { entryId: id } })

		expect(result.accepted).toBe(true)
		expect(queue.list().map((entry) => entry.text)).toEqual(["keep"])
	})

	it("reports a missing entry instead of silently succeeding", () => {
		const queue = seeded(["one"])

		for (const operation of [
			{ toggleMode: { entryId: "nope" } },
			{ reorder: { entryId: "nope", targetIndex: 0 } },
			{ beginEdit: { entryId: "nope" } },
			{ commitEdit: { entryId: "nope", draft: draft("x") } },
			{ cancelEdit: { entryId: "nope" } },
			{ remove: { entryId: "nope" } },
		]) {
			expect(applyInputQueueMutation(queue, operation)).toEqual({ accepted: false, result: "missing_entry" })
		}
		expect(queue.size).toBe(1)
	})
})
