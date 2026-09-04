import { beforeEach, describe, expect, it, vi } from "vitest"
import { RuntimeEventBus } from "../runtime-event-bus"
import { RuntimeTelemetryService } from "../runtime-telemetry-service"
import { RuntimeEventPriority, type RuntimeTelemetryEvent } from "../types"

/**
 * The service is the seam every producer talks to. These tests pin the two
 * properties producers depend on: a measurement always reaches the bus with a
 * duration, and a disabled service never forwards anything downstream.
 */

function createBus(): RuntimeEventBus {
	let monotonic = 0
	return new RuntimeEventBus({
		sessionId: "session-under-test",
		monotonicNow: () => (monotonic += 100),
		wallNow: () => 1_700_000_000_000,
	})
}

describe("RuntimeTelemetryService measurement", () => {
	let bus: RuntimeEventBus
	let service: RuntimeTelemetryService

	beforeEach(() => {
		bus = createBus()
		service = new RuntimeTelemetryService({ bus })
	})

	it("records a duration for a successful measured span", async () => {
		await service.measure("prompt.build", async () => "value")

		const [event] = bus.peek()
		expect(event?.name).toBe("prompt.build")
		expect(event?.attributes.outcome).toBe("success")
		expect(typeof event?.attributes.durationMs).toBe("number")
	})

	it("returns the measured value unchanged", async () => {
		const result = await service.measure("prompt.build", async () => ({ id: 7 }))

		expect(result).toEqual({ id: 7 })
	})

	it("records a failed span and rethrows the original error", async () => {
		const failure = new Error("build failed")

		await expect(service.measure("prompt.build", async () => Promise.reject(failure))).rejects.toBe(failure)

		const [event] = bus.peek()
		expect(event?.attributes.outcome).toBe("failure")
		expect(event?.priority).toBe(RuntimeEventPriority.Error)
		expect(event?.error?.message).toBe("build failed")
	})

	it("keeps producer attributes alongside the duration", async () => {
		await service.measure("terminal.execute", async () => undefined, { terminalCount: 3 })

		const [event] = bus.peek()
		expect(event?.attributes.terminalCount).toBe(3)
	})

	it("measures synchronous work without requiring a promise", () => {
		service.measureSync("state.build", () => 42)

		const [event] = bus.peek()
		expect(event?.name).toBe("state.build")
		expect(event?.attributes.outcome).toBe("success")
	})
})

describe("RuntimeTelemetryService gating", () => {
	it("does not record while disabled", () => {
		const bus = createBus()
		const service = new RuntimeTelemetryService({ bus, enabled: () => false })

		service.recordPhase("prompt.build", 12)
		service.recordDebug("cache.lookup", { hit: true })

		expect(bus.peek()).toHaveLength(0)
	})

	it("still records invariant breaches while disabled", () => {
		const bus = createBus()
		const service = new RuntimeTelemetryService({ bus, enabled: () => false })

		service.recordInvariant("task.double_dispose", { taskCount: 2 })

		expect(bus.peek()).toHaveLength(1)
	})

	it("resumes recording when the gate reopens", () => {
		const bus = createBus()
		let enabled = false
		const service = new RuntimeTelemetryService({ bus, enabled: () => enabled })

		service.recordPhase("prompt.build", 12)
		enabled = true
		service.recordPhase("prompt.build", 13)

		expect(bus.peek()).toHaveLength(1)
	})
})

describe("RuntimeTelemetryService downstream forwarding", () => {
	it("forwards recorded events to a sink", () => {
		const bus = createBus()
		const service = new RuntimeTelemetryService({ bus })
		const received: RuntimeTelemetryEvent[] = []
		service.onEvent((event) => received.push(event))

		service.recordPhase("prompt.build", 12)

		expect(received.map((event) => event.name)).toEqual(["prompt.build"])
	})

	it("stops forwarding after the subscription is released", () => {
		const bus = createBus()
		const service = new RuntimeTelemetryService({ bus })
		const sink = vi.fn()
		const unsubscribe = service.onEvent(sink)

		unsubscribe()
		service.recordPhase("prompt.build", 12)

		expect(sink).not.toHaveBeenCalled()
	})

	it("scopes recorded events to the running task without letting the caller relabel the session", () => {
		const bus = createBus()
		const service = new RuntimeTelemetryService({ bus })

		// A caller that tries to supply a session id must not succeed. The cast
		// stands in for untyped or generated call sites; the type itself already
		// excludes the field.
		service.withContext({ taskId: "task-1", sessionId: "forged" } as never, () => {
			service.recordPhase("prompt.build", 12)
		})

		const [event] = bus.peek()
		expect(event?.context.taskId).toBe("task-1")
		expect(event?.context.sessionId).toBe("session-under-test")
	})
})
