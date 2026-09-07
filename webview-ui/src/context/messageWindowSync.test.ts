import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"

import { isMessageWindowOverfull, reconcileMessageWindow } from "./messageWindowSync"

/**
 * Build a minimal message identified by its timestamp.
 *
 * @param ts Message timestamp.
 * @param partial Whether the message is a streaming frame.
 * @returns Message usable by the reconciliation contract.
 */
function message(ts: number, partial?: boolean): ClineMessage {
	return { ts, type: "say", say: "text", text: `m${ts}`, partial } as ClineMessage
}

describe("reconcileMessageWindow", () => {
	it("drops a message the backend removed inside the fetched span", () => {
		const result = reconcileMessageWindow(
			{ messages: [message(1), message(2), message(3)], startIndex: 0 },
			{ messages: [message(1), message(3)], startIndex: 0, total: 2 },
		)

		expect(result.messages.map((entry) => entry.ts)).toEqual([1, 3])
		expect(result.removed).toBe(true)
	})

	it("keeps a restore that truncated the tail and appended a new message", () => {
		// Restore removed ts=3 and appended ts=4, so the total is unchanged and
		// only the fetched span can reveal the deletion.
		const result = reconcileMessageWindow(
			{ messages: [message(1), message(2), message(3)], startIndex: 0 },
			{ messages: [message(1), message(2), message(4)], startIndex: 0, total: 3 },
		)

		expect(result.messages.map((entry) => entry.ts)).toEqual([1, 2, 4])
		expect(result.removed).toBe(true)
	})

	it("preserves local messages older than the fetched span", () => {
		const result = reconcileMessageWindow(
			{ messages: [message(1), message(2), message(5)], startIndex: 10 },
			{ messages: [message(5), message(6)], startIndex: 12, total: 14 },
		)

		expect(result.messages.map((entry) => entry.ts)).toEqual([1, 2, 5, 6])
		expect(result.removed).toBe(false)
	})

	it("moves the window start back to cover preserved leading messages", () => {
		const result = reconcileMessageWindow(
			{ messages: [message(1), message(2), message(5)], startIndex: 10 },
			{ messages: [message(5), message(6)], startIndex: 12, total: 14 },
		)

		expect(result.startIndex).toBe(10)
	})

	it("replaces a local partial with the durable fetched message", () => {
		const result = reconcileMessageWindow(
			{ messages: [message(1), message(2, true)], startIndex: 0 },
			{ messages: [message(1), message(2)], startIndex: 0, total: 2 },
		)

		expect(result.messages.map((entry) => entry.partial)).toEqual([undefined, undefined])
	})

	it("does not let a slow response overwrite a newer durable local message", () => {
		// The realtime stream already upgraded ts=2 to an ask; a fetch that was
		// in flight before that must not push the older say back on screen.
		const durableAsk = { ts: 2, type: "ask", ask: "completion_result", text: "Completed" } as ClineMessage
		const staleSay = { ts: 2, type: "say", say: "completion_result", text: "Completed" } as ClineMessage

		const result = reconcileMessageWindow(
			{ messages: [message(1), durableAsk], startIndex: 0 },
			{ messages: [message(1), staleSay], startIndex: 0, total: 2 },
		)

		expect(result.messages[1]).toBe(durableAsk)
		expect(result.removed).toBe(false)
	})

	it("clears the window when the backend reports an empty conversation", () => {
		const result = reconcileMessageWindow(
			{ messages: [message(1)], startIndex: 0 },
			{ messages: [], startIndex: 0, total: 0 },
		)

		expect(result.messages).toEqual([])
		expect(result.startIndex).toBe(0)
		expect(result.removed).toBe(true)
	})

	it("treats an empty answer for a non-empty conversation as no information", () => {
		const local = { messages: [message(1), message(2)], startIndex: 0 }

		const result = reconcileMessageWindow(local, { messages: [], startIndex: 40, total: 40 })

		expect(result.messages).toBe(local.messages)
		expect(result.removed).toBe(false)
	})
})

describe("isMessageWindowOverfull", () => {
	it("detects a window claiming more messages than the backend holds", () => {
		expect(isMessageWindowOverfull(10, 0, 9)).toBe(true)
	})

	it("accepts a window that fits the reported total", () => {
		expect(isMessageWindowOverfull(10, 0, 10)).toBe(false)
		expect(isMessageWindowOverfull(10, 30, 40)).toBe(false)
	})
})
