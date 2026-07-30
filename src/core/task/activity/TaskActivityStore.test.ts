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

	it("keeps command output raw without synthetic output or metrics events", () => {
		const store = new TaskActivityStore("task-1")
		store.create({
			activityId: "command-1",
			kind: "command",
			executionMode: "foreground",
			title: "npm test",
		})

		store.appendOutput("command-1", "actual stdout\n")
		store.update("command-1", { metrics: { lineCount: 1 } })

		const activity = store.get("command-1")
		expect(activity?.output).toBe("actual stdout\n")
		expect(activity?.metrics).toBeUndefined()
		expect(activity?.events.map((event) => event.kind)).toEqual(["status"])
	})

	it("filters task-owned activities without treating explicit background work as Task lifecycle work", () => {
		const store = new TaskActivityStore("task-1")
		store.create({
			activityId: "foreground-command",
			kind: "command",
			executionMode: "foreground",
			cancellationOwner: "task",
			title: "npm test",
		})
		store.create({
			activityId: "background-command",
			kind: "command",
			executionMode: "background",
			cancellationOwner: "explicit",
			title: "npm run dev",
		})

		expect(store.listRunning("task").map((activity) => activity.activityId)).toEqual(["foreground-command"])
	})

	it("exposes cancellation only while a live canceller is bound", () => {
		const store = new TaskActivityStore("task-1")
		store.create({
			activityId: "subagent-1",
			kind: "subagent",
			executionMode: "background",
			title: "research",
		})

		expect(store.isCancellable("subagent-1")).toBe(false)
		store.setCancel("subagent-1", async () => undefined)
		expect(store.isCancellable("subagent-1")).toBe(true)
		store.update("subagent-1", { status: "completed" })
		expect(store.isCancellable("subagent-1")).toBe(false)
	})

	it("keeps ordered typed events and persists history for reopen", async () => {
		const persisted: Array<ReturnType<TaskActivityStore["list"]>> = []
		const persistence = {
			load: vi.fn(async () => persisted.at(-1) ?? []),
			save: vi.fn(async (activities: ReturnType<TaskActivityStore["list"]>) => {
				persisted.push(activities)
			}),
		}
		const store = new TaskActivityStore("task-1", persistence)
		store.create({
			activityId: "subagent-1",
			kind: "subagent",
			executionMode: "background",
			title: "research",
		})
		store.appendEvent("subagent-1", { kind: "thinking", phase: "delta", text: "considering" })
		store.appendEvent("subagent-1", {
			kind: "assistant_message",
			phase: "final",
			text: "I will inspect it. api_key=private-value",
		})
		store.appendEvent("subagent-1", {
			kind: "tool_call",
			toolCallId: "tid-1",
			toolName: "read_file",
			toolStatus: "started",
			summary: "read target",
		})
		store.appendEvent("subagent-1", {
			kind: "tool_result",
			toolCallId: "tid-1",
			toolName: "read_file",
			text: "file content",
		})
		store.update("subagent-1", { metrics: { toolCalls: 1, inputTokens: 10 } })
		await store.waitForPersistence()

		const events = store.get("subagent-1")?.events ?? []
		expect(events.map((event) => event.kind)).toEqual([
			"status",
			"thinking",
			"assistant_message",
			"tool_call",
			"tool_result",
			"metrics",
		])
		expect(events.map((event) => event.sequence)).toEqual([...events.map((event) => event.sequence)].sort((a, b) => a - b))
		expect(events.find((event) => event.kind === "assistant_message")).toMatchObject({
			text: "I will inspect it. api_key=[REDACTED]",
		})

		const reopened = new TaskActivityStore("task-1", persistence)
		await reopened.hydrate()
		expect(reopened.get("subagent-1")?.events).toEqual(events)
		expect(reopened.isCancellable("subagent-1")).toBe(false)
	})

	it("merges hydrated history before persisting an opening live activity", async () => {
		let resolveLoad!: (activities: ReturnType<TaskActivityStore["list"]>) => void
		const load = vi.fn(
			async () =>
				new Promise<ReturnType<TaskActivityStore["list"]>>((resolve) => {
					resolveLoad = resolve
				}),
		)
		const save = vi.fn(async (_activities: ReturnType<TaskActivityStore["list"]>) => undefined)
		const historicalStore = new TaskActivityStore("task-1")
		historicalStore.create({
			activityId: "historical-command",
			kind: "command",
			executionMode: "background",
			title: "historical",
		})
		const store = new TaskActivityStore("task-1", { load, save })
		const unsubscribe = store.subscribe(vi.fn())
		store.create({
			activityId: "live-command",
			kind: "command",
			executionMode: "foreground",
			title: "live",
		})
		resolveLoad(historicalStore.list())
		await store.waitForPersistence()
		unsubscribe()

		expect(
			save.mock.calls
				.at(-1)?.[0]
				.map((activity) => activity.activityId)
				.sort(),
		).toEqual(["historical-command", "live-command"])
	})

	it("redacts obvious secrets from every persisted activity text field", async () => {
		const save = vi.fn(async (_activities: ReturnType<TaskActivityStore["list"]>) => undefined)
		const store = new TaskActivityStore("task-1", {
			load: vi.fn(async () => []),
			save,
		})
		store.create({
			activityId: "command-1",
			kind: "command",
			executionMode: "background",
			title: "serve --api_key=title-secret",
			detail: "Authorization: Bearer detail-secret-token",
		})
		store.appendOutput("command-1", "access_token=output-secret\n")
		store.update("command-1", {
			status: "completed",
			latestEvent: "password=event-secret",
			result: "github_pat_1234567890abcdef",
			error: "secret=error-secret",
		})
		await store.waitForPersistence()

		const serialized = JSON.stringify(save.mock.calls.at(-1)?.[0])
		expect(serialized).toContain("[REDACTED]")
		for (const secret of [
			"title-secret",
			"detail-secret-token",
			"output-secret",
			"event-secret",
			"github_pat_1234567890abcdef",
			"error-secret",
		]) {
			expect(serialized).not.toContain(secret)
		}
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
