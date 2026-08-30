import type { QueuedInputEntry } from "@shared/InputQueue"
import { describe, expect, it } from "vitest"
import { type InputQueueWriteContext, resolveInputQueueWrite } from "./InputQueueProjection"

const entry = (id: string, text: string): QueuedInputEntry => ({
	id,
	text,
	images: [],
	files: [],
	mode: "queued",
	sequence: 0,
})

/** Defaults for the common case: the file was read and this is a normal write. */
const context = (overrides: Partial<InputQueueWriteContext>): InputQueueWriteContext => ({
	committed: undefined,
	persisted: undefined,
	readFailed: false,
	intent: "ordinary",
	...overrides,
})

describe("resolveInputQueueWrite", () => {
	/**
	 * The regression this guards: a runtime snapshot can be written before the
	 * queue has been read back from disk. Writing an empty queue there would
	 * delete input the user queued in a previous session, which only an explicit
	 * removal is allowed to do.
	 */
	it("keeps what the snapshot already holds while the queue is unknown", () => {
		const onDisk = [entry("a", "queued last session")]
		expect(resolveInputQueueWrite(context({ persisted: onDisk }))).toEqual({ kind: "write", entries: onDisk })
	})

	it("leaves an absent queue absent while it is unknown", () => {
		expect(resolveInputQueueWrite(context({}))).toEqual({ kind: "write", entries: undefined })
	})

	it("writes an empty queue once it is known to be empty", () => {
		// Distinguishing this from the unknown case is the whole point: here the
		// user really has no queued input and the file must say so.
		expect(resolveInputQueueWrite(context({ committed: [], persisted: [entry("a", "delivered")] }))).toEqual({
			kind: "write",
			entries: [],
		})
	})

	it("writes the committed queue over whatever the snapshot carried", () => {
		const committed = [entry("b", "current")]
		expect(resolveInputQueueWrite(context({ committed, persisted: [entry("a", "stale")] }))).toEqual({
			kind: "write",
			entries: committed,
		})
	})

	it("copies the result so a later mutation cannot reach the written value", () => {
		const committed = [entry("b", "current")]
		const decision = resolveInputQueueWrite(context({ committed }))
		expect(decision.kind === "write" && decision.entries).not.toBe(committed)
	})

	/**
	 * A failed read means the file may still hold input this task never saw.
	 * Resume rebuilds a snapshot from history with no queue at all, so writing
	 * that rebuilt value would delete input the user never removed.
	 */
	it("preserves the queue on disk when it could not be read", () => {
		expect(resolveInputQueueWrite(context({ readFailed: true }))).toEqual({ kind: "preserve" })
	})

	/**
	 * Enqueueing is not the user saying the rest of the queue is unwanted. The
	 * in-memory queue after a failed read holds only what this session added, so
	 * writing it would silently drop everything the file may still contain.
	 */
	it("keeps preserving after a failed read when the change is an ordinary one", () => {
		const committed = [entry("c", "queued after the failure")]
		expect(resolveInputQueueWrite(context({ committed, readFailed: true }))).toEqual({ kind: "preserve" })
	})

	it("lets an explicit removal replace a queue that could not be read", () => {
		// Removal is the user discarding input on purpose, which is the one
		// change the contract allows to drop entries.
		const committed = [entry("d", "kept")]
		expect(resolveInputQueueWrite(context({ committed, readFailed: true, intent: "user_removal" }))).toEqual({
			kind: "write",
			entries: committed,
		})
	})
})
