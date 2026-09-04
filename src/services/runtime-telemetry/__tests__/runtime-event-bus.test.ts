import { describe, expect, it, vi } from "vitest"
import { RuntimeContentPolicy } from "../content-policy"
import { RuntimeEventBus } from "../runtime-event-bus"
import { RuntimeDropReason, RuntimeEventPriority, type RuntimeTelemetryEvent } from "../types"

function createBus(capacity = 8): RuntimeEventBus {
	let monotonic = 0
	return new RuntimeEventBus({
		sessionId: "session-under-test",
		capacity,
		monotonicNow: () => ++monotonic,
		wallNow: () => 1_700_000_000_000,
	})
}

describe("RuntimeEventBus ordering", () => {
	it("assigns strictly increasing sequence numbers to concurrent producers", async () => {
		const bus = createBus(64)

		const results = await Promise.all(
			Array.from({ length: 32 }, (_, index) =>
				Promise.resolve().then(() => bus.record({ name: `phase.${index}`, priority: RuntimeEventPriority.Info })),
			),
		)

		const sequences = results.map((event) => event?.sequence)
		expect(sequences).toEqual(Array.from({ length: 32 }, (_, index) => index + 1))
		expect(new Set(results.map((event) => event?.eventId)).size).toBe(32)
	})

	it("keeps sequence numbering independent between sessions", () => {
		const first = createBus()
		const second = createBus()

		first.record({ name: "a", priority: RuntimeEventPriority.Info })
		first.record({ name: "b", priority: RuntimeEventPriority.Info })
		const secondEvent = second.record({ name: "a", priority: RuntimeEventPriority.Info })

		expect(secondEvent?.sequence).toBe(1)
	})
})

describe("RuntimeEventBus context resolution", () => {
	it("prefers an explicit context over the ambient one", () => {
		const bus = createBus()

		const event = bus.context.run({ taskId: "ambient" }, () =>
			bus.record({
				name: "task.phase",
				priority: RuntimeEventPriority.Info,
				context: { taskId: "explicit" },
			}),
		)

		expect(event?.context.taskId).toBe("explicit")
	})

	it("prefers the ambient context over the session fallback", () => {
		const bus = createBus()

		const event = bus.context.run({ taskId: "ambient" }, () =>
			bus.record({ name: "task.phase", priority: RuntimeEventPriority.Info }),
		)

		expect(event?.context.taskId).toBe("ambient")
	})

	it("falls back to the session context outside any run scope", () => {
		const bus = createBus()

		// A listener registered at activation, or a timer created before any task
		// existed, has no ambient store at all. It must still produce a usable
		// event rather than an unattributed one.
		const event = bus.record({ name: "detached", priority: RuntimeEventPriority.Info })

		expect(event?.context.taskId).toBeUndefined()
		expect(event?.context.sessionId).toBe("session-under-test")
	})

	it("restores a captured context around a detached continuation", async () => {
		const bus = createBus()

		const captured = bus.context.run({ taskId: "ambient" }, () => bus.context.capture())
		const event = await new Promise<RuntimeTelemetryEvent | undefined>((resolve) => {
			setTimeout(
				() =>
					resolve(
						bus.context.restore(captured, () => bus.record({ name: "resumed", priority: RuntimeEventPriority.Info })),
					),
				0,
			)
		})

		expect(event?.context.taskId).toBe("ambient")
	})

	it("never lets a producer override the session id", () => {
		const bus = createBus()

		const event = bus.record({
			name: "task.phase",
			priority: RuntimeEventPriority.Info,
			context: { sessionId: "forged" } as never,
		})

		expect(event?.context.sessionId).toBe("session-under-test")
	})

	it("keeps concurrent task contexts separate", async () => {
		const bus = createBus(64)

		const [first, second] = await Promise.all([
			bus.context.run({ taskId: "task-a" }, async () => {
				await Promise.resolve()
				return bus.record({ name: "task.phase", priority: RuntimeEventPriority.Info })
			}),
			bus.context.run({ taskId: "task-b" }, async () => {
				await Promise.resolve()
				return bus.record({ name: "task.phase", priority: RuntimeEventPriority.Info })
			}),
		])

		expect(first?.context.taskId).toBe("task-a")
		expect(second?.context.taskId).toBe("task-b")
	})
})

describe("RuntimeEventBus back pressure", () => {
	it("evicts the lowest-priority event when the queue is full", () => {
		const bus = createBus(2)

		bus.record({ name: "debug", priority: RuntimeEventPriority.Debug })
		bus.record({ name: "info", priority: RuntimeEventPriority.Info })
		const admitted = bus.record({ name: "invariant", priority: RuntimeEventPriority.Invariant })

		expect(admitted).toBeDefined()
		expect(bus.peek().map((event) => event.name)).toEqual(["info", "invariant"])
		expect(bus.drops.byPriority[RuntimeEventPriority.Debug]).toBe(1)
		expect(bus.drops.byReason[RuntimeDropReason.QueueFull]).toBe(1)
	})

	it("drops the incoming event when nothing less important is queued", () => {
		const bus = createBus(2)

		bus.record({ name: "error-a", priority: RuntimeEventPriority.Error })
		bus.record({ name: "error-b", priority: RuntimeEventPriority.Error })
		const rejected = bus.record({ name: "debug", priority: RuntimeEventPriority.Debug })

		expect(rejected).toBeUndefined()
		expect(bus.peek().map((event) => event.name)).toEqual(["error-a", "error-b"])
		expect(bus.drops.byPriority[RuntimeEventPriority.Debug]).toBe(1)
	})

	it("counts events rejected after disposal", () => {
		const bus = createBus()
		bus.dispose()

		expect(bus.record({ name: "late", priority: RuntimeEventPriority.Error })).toBeUndefined()
		expect(bus.drops.byReason[RuntimeDropReason.Disposed]).toBe(1)
	})
})

describe("RuntimeEventBus content policy", () => {
	it("strips user and tool content from attributes", () => {
		const bus = createBus()

		const event = bus.record({
			name: "terminal.execute",
			priority: RuntimeEventPriority.Performance,
			attributes: {
				terminalId: "terminal-3",
				durationMs: 42,
				command: "rm -rf /tmp/secret",
				stdout: "confidential output",
			},
		})

		expect(event?.attributes).toEqual({ terminalId: "terminal-3", durationMs: 42 })
	})

	it("rejects nested objects instead of serializing them", () => {
		const bus = createBus()

		const event = bus.record({
			name: "mcp.connect",
			priority: RuntimeEventPriority.Info,
			attributes: { serverName: "github", config: { token: "secret" } },
		})

		expect(event?.attributes).toEqual({ serverName: "github" })
	})

	it("drops attributes whose value grows past the identifier budget", () => {
		const bus = createBus()

		const event = bus.record({
			name: "prompt.build",
			priority: RuntimeEventPriority.Info,
			attributes: { variant: "x".repeat(200), stage: "assemble" },
		})

		expect(event?.attributes).toEqual({ stage: "assemble" })
	})

	it("produces a stable fingerprint that differs between sessions", () => {
		const first = new RuntimeContentPolicy()
		const second = new RuntimeContentPolicy()

		expect(first.fingerprint("e:/workspace/project")).toBe(first.fingerprint("e:/workspace/project"))
		expect(first.fingerprint("e:/workspace/project")).not.toBe(second.fingerprint("e:/workspace/project"))
	})
})

describe("RuntimeEventBus error handling", () => {
	it("normalizes an error into safe identity fields", () => {
		const bus = createBus()
		const failure = Object.assign(new Error("Request failed with status code 429"), {
			code: "ERR_BAD_REQUEST",
			status: 429,
		})

		const event = bus.record({ name: "api.request", priority: RuntimeEventPriority.Error, error: failure })

		expect(event?.error?.name).toBe("Error")
		expect(event?.error?.code).toBe("ERR_BAD_REQUEST")
		expect(event?.error?.status).toBe(429)
		expect(event?.error?.fingerprint).toContain("ERR_BAD_REQUEST")
	})

	it("gives two occurrences of the same failure one fingerprint", () => {
		const bus = createBus()
		// Both errors originate from the same line, as two occurrences of one
		// defect do in production. Only the task id and the elapsed time differ.
		const raise = (taskId: string, elapsedMs: number): Error => new Error(`task ${taskId} failed after ${elapsedMs}ms`)

		const first = bus.record({
			name: "api.request",
			priority: RuntimeEventPriority.Error,
			error: raise("1788537591853", 3200),
		})
		const second = bus.record({
			name: "api.request",
			priority: RuntimeEventPriority.Error,
			error: raise("1788538925641", 5100),
		})

		expect(first?.error?.fingerprint).toBe(second?.error?.fingerprint)
	})

	it("separates failures that differ in class or code", () => {
		const bus = createBus()

		const timeout = bus.record({
			name: "api.request",
			priority: RuntimeEventPriority.Error,
			error: Object.assign(new Error("request failed"), { code: "ETIMEDOUT" }),
		})
		const refused = bus.record({
			name: "api.request",
			priority: RuntimeEventPriority.Error,
			error: Object.assign(new Error("request failed"), { code: "ECONNREFUSED" }),
		})

		expect(timeout?.error?.fingerprint).not.toBe(refused?.error?.fingerprint)
	})

	it("isolates a failing subscriber", () => {
		const bus = createBus()
		const healthy = vi.fn()
		bus.subscribe(() => {
			throw new Error("subscriber defect")
		})
		bus.subscribe(healthy)

		expect(() => bus.record({ name: "task.start", priority: RuntimeEventPriority.Info })).not.toThrow()
		expect(healthy).toHaveBeenCalledTimes(1)
	})

	it("stops delivering to an unsubscribed listener", () => {
		const bus = createBus()
		const listener = vi.fn()
		const unsubscribe = bus.subscribe(listener)

		bus.record({ name: "task.start", priority: RuntimeEventPriority.Info })
		unsubscribe()
		bus.record({ name: "task.end", priority: RuntimeEventPriority.Info })

		expect(listener).toHaveBeenCalledTimes(1)
	})
})
