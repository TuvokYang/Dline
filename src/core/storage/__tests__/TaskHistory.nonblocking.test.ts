import { describe, expect, it, vi } from "vitest"
import type { HistoryItem } from "@/shared/HistoryItem"
import type { BufferedUnifyStore } from "../backend/api/UnifyStore"
import { TaskHistory } from "../TaskHistory"

const ITEM: HistoryItem = {
	id: "task-1",
	ts: 1,
	task: "nonblocking",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
}

/**
 * Settle every already-scheduled microtask.
 *
 * The update must not wait for the delayed stage, but it still crosses the
 * write mutex, whose own scheduling costs a few microticks. Yielding through
 * the macrotask queue keeps the assertion about the stage rather than about the
 * exact number of ticks the mutex happens to use.
 */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("TaskHistory metadata hot path", () => {
	it("accepts a metadata update without waiting for a delayed storage stage", async () => {
		let release: (() => void) | undefined
		const delayedStage = new Promise<void>((resolve) => {
			release = resolve
		})
		const store = {
			reload: vi.fn().mockResolvedValue(undefined),
			getAll: vi.fn().mockReturnValue([]),
			stageInsertAt: vi.fn().mockReturnValue(delayedStage),
			flush: vi.fn().mockResolvedValue(undefined),
		} as unknown as BufferedUnifyStore<HistoryItem>
		const history = new TaskHistory(store)

		let accepted = false
		const update = history.upsertTaskHistory(ITEM).then(() => {
			accepted = true
		})
		await flushMicrotasks()

		// The stage is still pending, yet the caller has already been released.
		expect(accepted).toBe(true)
		expect(store.stageInsertAt).toHaveBeenCalledTimes(1)
		release?.()
		await update
	})

	it("joins the staged write before reporting durability", async () => {
		let release: (() => void) | undefined
		const delayedStage = new Promise<void>((resolve) => {
			release = resolve
		})
		const store = {
			reload: vi.fn().mockResolvedValue(undefined),
			getAll: vi.fn().mockReturnValue([]),
			stageInsertAt: vi.fn().mockReturnValue(delayedStage),
			flush: vi.fn().mockResolvedValue(undefined),
		} as unknown as BufferedUnifyStore<HistoryItem>
		const history = new TaskHistory(store)

		await history.upsertTaskHistory(ITEM)
		let flushed = false
		const durable = history.flush().then(() => {
			flushed = true
		})
		await flushMicrotasks()

		// Durability must not be claimed while the staged write is outstanding.
		expect(flushed).toBe(false)
		expect(store.flush).not.toHaveBeenCalled()
		release?.()
		await durable
		expect(store.flush).toHaveBeenCalledTimes(1)
	})
})
