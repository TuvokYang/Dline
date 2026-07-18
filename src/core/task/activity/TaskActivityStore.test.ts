import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskActivityStore } from "./TaskActivityStore"

describe("TaskActivityStore", () => {
	afterEach(() => vi.useRealTimers())

	it("sends one initial snapshot and batches output updates", async () => {
		vi.useFakeTimers()
		const store = new TaskActivityStore("task-1")
		const listener = vi.fn()
		store.subscribe(listener)
		store.create({
			activityId: "command-1",
			kind: "command",
			executionMode: "foreground",
			title: "npm test",
		})
		await vi.advanceTimersByTimeAsync(0)
		listener.mockClear()

		store.appendOutput("command-1", "first\n")
		store.appendOutput("command-1", "second\n")
		expect(listener).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(75)
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0][0]).toMatchObject({
			snapshot: false,
			activities: [{ activityId: "command-1", output: "first\nsecond\n" }],
		})
	})

	it("keeps only the bounded output tail", () => {
		const store = new TaskActivityStore("task-1")
		store.create({
			activityId: "command-1",
			kind: "command",
			executionMode: "background",
			title: "large output",
		})
		store.appendOutput("command-1", `${"a".repeat(70_000)}tail`)

		const output = store.get("command-1")?.output
		expect(output).toHaveLength(64 * 1024)
		expect(output?.endsWith("tail")).toBe(true)
	})

	it("cancels an exact activity and suppresses late completion", async () => {
		const cancel = vi.fn(async () => undefined)
		const store = new TaskActivityStore("task-1")
		store.create({
			activityId: "subagent-1",
			kind: "subagent",
			executionMode: "background",
			title: "research",
			cancel,
		})

		expect(await store.cancel(["subagent-1"])).toEqual(["subagent-1"])
		store.update("subagent-1", { status: "completed", result: "late result" })

		expect(cancel).toHaveBeenCalledTimes(1)
		expect(store.get("subagent-1")?.status).toBe("cancelled")
		expect(store.get("subagent-1")?.result).toBeUndefined()
	})
})
