import type { QueuedInputEntry } from "@shared/InputQueue"
import { describe, expect, it } from "vitest"
import { createInputQueueWriteTicket, inputQueueWriteSucceeded, recordInputQueueWriteOutcome } from "./InputQueueWriteTicket"

const entry = (id: string): QueuedInputEntry => ({
	id,
	text: id,
	images: [],
	files: [],
	mode: "queued",
	sequence: 0,
})

describe("InputQueueWriteTicket", () => {
	it("starts pending, so an unreached writer is never mistaken for a success", () => {
		const ticket = createInputQueueWriteTicket([entry("a")], "ordinary")

		expect(ticket.outcome).toBe("pending")
		expect(inputQueueWriteSucceeded(ticket)).toBe(false)
	})

	it("reports success only once the current queue actually reached the file", () => {
		const ticket = createInputQueueWriteTicket([entry("a")], "ordinary")

		recordInputQueueWriteOutcome(ticket, "written")

		expect(inputQueueWriteSucceeded(ticket)).toBe(true)
	})

	// Preserving keeps whatever the file already held, which means the claim or
	// edit this ticket represents is NOT on disk. Reporting it as a success is
	// what let a delivery proceed without a durable in-flight mark.
	it("does not report success when the write only preserved the old queue", () => {
		const ticket = createInputQueueWriteTicket([entry("a")], "ordinary")

		recordInputQueueWriteOutcome(ticket, "preserved")

		expect(inputQueueWriteSucceeded(ticket)).toBe(false)
	})

	it("does not report success when the write failed", () => {
		const ticket = createInputQueueWriteTicket([entry("a")], "ordinary")

		recordInputQueueWriteOutcome(ticket, "failed")

		expect(inputQueueWriteSucceeded(ticket)).toBe(false)
	})

	// A snapshot write can be followed by another one while the ticket is still
	// open. The first non-write result is the one that describes this ticket's
	// queue, so a later unrelated success must not overwrite it.
	it("keeps the first settled outcome when a later write reports another", () => {
		const ticket = createInputQueueWriteTicket([entry("a")], "ordinary")

		recordInputQueueWriteOutcome(ticket, "preserved")
		recordInputQueueWriteOutcome(ticket, "written")

		expect(ticket.outcome).toBe("preserved")
		expect(inputQueueWriteSucceeded(ticket)).toBe(false)
	})

	// The intent travels with the ticket rather than on the task, so a failed
	// removal cannot leave "user_removal" behind for an unrelated later write
	// to use as permission to replace a queue it never read.
	it("carries the intent of the change it represents", () => {
		const removal = createInputQueueWriteTicket([entry("a")], "user_removal")
		const ordinary = createInputQueueWriteTicket([entry("a")], "ordinary")

		expect(removal.intent).toBe("user_removal")
		expect(ordinary.intent).toBe("ordinary")
	})

	it("copies the entries so a later queue change cannot alter what was submitted", () => {
		const entries = [entry("a")]
		const ticket = createInputQueueWriteTicket(entries, "ordinary")

		entries.push(entry("b"))

		expect(ticket.entries).toHaveLength(1)
	})
})
