import type { HistoryItem } from "@shared/HistoryItem"
import { describe, expect, it, vi } from "vitest"
import { type RecoveredCompletion, TaskCompletionBackfill } from "../TaskCompletionBackfill"

type PersistFn = (taskId: string, isCompleted: boolean, revision: number) => Promise<boolean>

function item(id: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
	return { id, task: `Task ${id}`, ts: 100, tokensIn: 0, tokensOut: 0, totalCost: 0, ...overrides }
}

function backfill(options: {
	tasks: HistoryItem[]
	completions: Record<string, RecoveredCompletion | undefined>
	persist?: ReturnType<typeof vi.fn<PersistFn>>
	onRepaired?: ReturnType<typeof vi.fn<(repairedCount: number) => void>>
}) {
	const persist = options.persist ?? vi.fn<PersistFn>(async () => true)
	return {
		persist,
		runner: new TaskCompletionBackfill({
			listTasks: async () => options.tasks,
			readCompletion: async (taskId) => options.completions[taskId],
			persist,
			onRepaired: options.onRepaired,
			yieldBetweenChunks: async () => undefined,
		}),
	}
}

describe("TaskCompletionBackfill", () => {
	it("repairs a completed task whose projection was cleared", async () => {
		const { runner, persist } = backfill({
			tasks: [item("task-1", { isCompleted: false, completionStateRevision: 87 })],
			completions: { "task-1": { isCompleted: true } },
		})

		await expect(runner.run()).resolves.toEqual({ scanned: 1, repaired: 1, failed: 0 })
		// The revision must clear the stored watermark or the store rejects it.
		expect(persist).toHaveBeenCalledExactlyOnceWith("task-1", true, 88)
	})

	it("establishes a missing projection for a completed task", async () => {
		const { runner, persist } = backfill({
			tasks: [item("task-1")],
			completions: { "task-1": { isCompleted: true } },
		})

		await expect(runner.run()).resolves.toMatchObject({ repaired: 1 })
		expect(persist).toHaveBeenCalledExactlyOnceWith("task-1", true, 1)
	})

	it("leaves an already correct projection untouched", async () => {
		const { runner, persist } = backfill({
			tasks: [item("task-1", { isCompleted: true, completionStateRevision: 5 })],
			completions: { "task-1": { isCompleted: true } },
		})

		await expect(runner.run()).resolves.toEqual({ scanned: 1, repaired: 0, failed: 0 })
		expect(persist).not.toHaveBeenCalled()
	})

	it("never invents a verdict for a task without a readable snapshot", async () => {
		const { runner, persist } = backfill({
			tasks: [item("task-1", { isCompleted: true, completionStateRevision: 5 }), item("task-2")],
			completions: {},
		})

		await expect(runner.run()).resolves.toEqual({ scanned: 2, repaired: 0, failed: 0 })
		expect(persist).not.toHaveBeenCalled()
	})

	it("counts a rejected durable write as unrepaired", async () => {
		const { runner } = backfill({
			tasks: [item("task-1")],
			completions: { "task-1": { isCompleted: true } },
			persist: vi.fn<PersistFn>(async () => false),
		})

		await expect(runner.run()).resolves.toEqual({ scanned: 1, repaired: 0, failed: 0 })
	})

	it("continues past one unreadable task and reports it as failed", async () => {
		const persist = vi.fn<PersistFn>(async () => true)
		const runner = new TaskCompletionBackfill({
			listTasks: async () => [item("broken"), item("task-2")],
			readCompletion: async (taskId) => {
				if (taskId === "broken") throw new Error("snapshot unreadable")
				return { isCompleted: true }
			},
			persist,
			yieldBetweenChunks: async () => undefined,
		})

		await expect(runner.run()).resolves.toEqual({ scanned: 2, repaired: 1, failed: 1 })
		expect(persist).toHaveBeenCalledExactlyOnceWith("task-2", true, 1)
	})

	it("notifies once with the repaired count so views can refresh", async () => {
		const onRepaired = vi.fn<(repairedCount: number) => void>()
		const { runner } = backfill({
			tasks: [item("task-1"), item("task-2")],
			completions: { "task-1": { isCompleted: true }, "task-2": { isCompleted: true } },
			onRepaired,
		})

		await runner.run()

		expect(onRepaired).toHaveBeenCalledExactlyOnceWith(2)
	})

	it("does not notify when nothing changed", async () => {
		const onRepaired = vi.fn<(repairedCount: number) => void>()
		const { runner } = backfill({
			tasks: [item("task-1", { isCompleted: true, completionStateRevision: 2 })],
			completions: { "task-1": { isCompleted: true } },
			onRepaired,
		})

		await runner.run()

		expect(onRepaired).not.toHaveBeenCalled()
	})

	it("yields between chunks so a long history cannot block the event loop", async () => {
		const yieldBetweenChunks = vi.fn(async () => undefined)
		const runner = new TaskCompletionBackfill({
			listTasks: async () => Array.from({ length: 60 }, (_, index) => item(`task-${index}`)),
			readCompletion: async () => undefined,
			persist: vi.fn<PersistFn>(async () => true),
			yieldBetweenChunks,
		})

		await expect(runner.run()).resolves.toMatchObject({ scanned: 60 })
		expect(yieldBetweenChunks).toHaveBeenCalledTimes(2)
	})
})
