import { describe, expect, it } from "vitest"
import { InputQueue } from "./InputQueue"
import { QUEUED_INPUT_GUIDANCE, takeQueueDelivery } from "./InputQueueDelivery"

function queueWith(drafts: Array<{ text: string; steering?: boolean; editing?: boolean }>): InputQueue {
	const queue = new InputQueue()
	for (const draft of drafts) {
		const id = queue.enqueue({ text: draft.text, images: [], files: [] })
		if (!id) throw new Error("enqueue rejected")
		if (draft.steering) queue.toggleMode(id)
		if (draft.editing) queue.beginEdit(id)
	}
	return queue
}

describe("takeQueueDelivery", () => {
	it("delivers nothing when the queue is empty", () => {
		expect(takeQueueDelivery(new InputQueue(), "turn-end")).toBeUndefined()
	})

	it("delivers one queued entry at a turn end", () => {
		const queue = queueWith([{ text: "first" }, { text: "second" }])

		const delivery = takeQueueDelivery(queue, "turn-end")

		expect(delivery?.kind).toBe("queued")
		expect(delivery?.entries.map((entry) => entry.text)).toEqual(["first"])
		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])
	})

	it("holds queued entries back between tool rounds", () => {
		const queue = queueWith([{ text: "first" }])

		expect(takeQueueDelivery(queue, "tool-round")).toBeUndefined()
		expect(queue.size).toBe(1)
	})

	// D3: steering always wins the round, and the queued entry it displaced is
	// deferred to the next turn end rather than dropped.
	it("yields the turn to steering and defers the queued entry", () => {
		const queue = queueWith([{ text: "queued one" }, { text: "steer one", steering: true }])

		const delivery = takeQueueDelivery(queue, "turn-end")

		expect(delivery?.kind).toBe("steering")
		expect(delivery?.entries.map((entry) => entry.text)).toEqual(["steer one"])
		expect(queue.list().map((entry) => entry.text)).toEqual(["queued one"])

		const next = takeQueueDelivery(queue, "turn-end")
		expect(next?.kind).toBe("queued")
		expect(next?.entries.map((entry) => entry.text)).toEqual(["queued one"])
	})

	it("delivers every steering entry in the same round", () => {
		const queue = queueWith([{ text: "steer one", steering: true }, { text: "plain" }, { text: "steer two", steering: true }])

		const delivery = takeQueueDelivery(queue, "tool-round")

		expect(delivery?.entries.map((entry) => entry.text)).toEqual(["steer one", "steer two"])
		expect(queue.list().map((entry) => entry.text)).toEqual(["plain"])
	})

	it("holds back an entry that is being edited", () => {
		const queue = queueWith([
			{ text: "steer editing", steering: true, editing: true },
			{ text: "queued editing", editing: true },
		])

		expect(takeQueueDelivery(queue, "turn-end")).toBeUndefined()
		expect(queue.size).toBe(2)
	})

	// Each entry has to stay a separate block; merging them would read as one
	// note and lose the boundaries between what the user said at each point.
	it("renders one self-contained user message block per entry", () => {
		const queue = queueWith([
			{ text: "steer one", steering: true },
			{ text: "steer two", steering: true },
		])

		const delivery = takeQueueDelivery(queue, "tool-round")

		expect(delivery?.blocks).toEqual([
			"<user_message>\nsteer one\n</user_message>",
			"<user_message>\nsteer two\n</user_message>",
		])
		expect(delivery?.text).toContain(QUEUED_INPUT_GUIDANCE)
	})

	// A steering batch can also land on a turn end, where the receiving handler
	// can only take one string and wraps it once. The per-entry tags have to
	// survive into `text`, or several messages arrive merged into one.
	it("keeps per-entry boundaries in the flat payload of a batch", () => {
		const queue = queueWith([
			{ text: "steer one", steering: true },
			{ text: "steer two", steering: true },
		])

		const delivery = takeQueueDelivery(queue, "turn-end")

		expect(delivery?.text).toBe(
			`${QUEUED_INPUT_GUIDANCE}\n\n<user_message>\nsteer one\n</user_message>\n\n<user_message>\nsteer two\n</user_message>`,
		)
	})

	// A single entry needs no tags: the handler already presents it as one
	// message, so wrapping would only add noise the user never wrote.
	it("sends a single entry without wrapping tags", () => {
		const queue = queueWith([{ text: "just one" }])

		const delivery = takeQueueDelivery(queue, "turn-end")

		expect(delivery?.text).toBe(`${QUEUED_INPUT_GUIDANCE}\n\njust one`)
	})

	it("collects the images and files carried by the delivered entries", () => {
		const queue = new InputQueue()
		queue.enqueue({ text: "with media", images: ["img-a"], files: ["file-a"] })

		const delivery = takeQueueDelivery(queue, "turn-end")

		expect(delivery?.images).toEqual(["img-a"])
		expect(delivery?.files).toEqual(["file-a"])
	})

	it("restores the delivered entries when delivery fails", () => {
		const queue = queueWith([{ text: "first" }, { text: "second" }])

		const delivery = takeQueueDelivery(queue, "turn-end")
		// Assert the claim actually happened, otherwise a delivery that never
		// took anything would satisfy the restore assertion by accident.
		expect(delivery?.entries.map((entry) => entry.text)).toEqual(["first"])
		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])

		delivery?.restore()

		expect(queue.list().map((entry) => entry.text)).toEqual(["first", "second"])
	})

	// Removal outranks a delivery that has not sent yet, and a remove request
	// can land after the claim was taken.
	it("drops entries the user removed after the claim", () => {
		const queue = queueWith([
			{ text: "keep", steering: true },
			{ text: "cancel me", steering: true },
		])
		const delivery = takeQueueDelivery(queue, "tool-round")
		const cancelled = delivery?.entries.find((entry) => entry.text === "cancel me")
		expect(cancelled).toBeDefined()

		queue.remove(cancelled?.id ?? "")
		const narrowed = delivery?.withoutCancelled()

		expect(narrowed?.entries.map((entry) => entry.text)).toEqual(["keep"])
		expect(narrowed?.text).not.toContain("cancel me")
	})

	it("reports nothing to send when every claimed entry was removed", () => {
		const queue = queueWith([{ text: "only one" }])
		const delivery = takeQueueDelivery(queue, "turn-end")
		queue.remove(delivery?.entries[0]?.id ?? "")

		expect(delivery?.withoutCancelled()).toBeUndefined()
	})

	it("drops the delivered entries once the delivery is committed", () => {
		const queue = queueWith([{ text: "first" }, { text: "second" }])

		const delivery = takeQueueDelivery(queue, "turn-end")
		expect(delivery?.entries.map((entry) => entry.text)).toEqual(["first"])

		delivery?.commit()

		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])
		// A late restore after a committed delivery must not resurrect it.
		delivery?.restore()
		expect(queue.list().map((entry) => entry.text)).toEqual(["second"])
	})
})
