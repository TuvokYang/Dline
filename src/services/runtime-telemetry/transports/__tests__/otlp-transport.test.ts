import { describe, expect, it, vi } from "vitest"
import { RuntimeEventPriority, type RuntimeTelemetryEvent } from "../../types"
import { OtlpTransport } from "../otlp-transport"

/**
 * The OTLP transport is the only outbound path runtime telemetry has. These
 * tests pin the properties that keep it from harming the extension: it batches,
 * it gives up quickly, and a collector that is down or slow degrades the
 * transport rather than the task producing the events.
 */

function event(sequence: number): RuntimeTelemetryEvent {
	return {
		eventId: `event-${sequence}`,
		sequence,
		timestamp: 1_700_000_000_000 + sequence,
		monotonicMs: sequence,
		name: "task.phase",
		priority: RuntimeEventPriority.Info,
		context: { sessionId: "session-under-test" },
		attributes: { durationMs: sequence },
	}
}

function okResponse(): Response {
	return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
}

/** `vi.fn` infers a zero-argument signature for the handlers that ignore their input. */
function requestAt(fetchImpl: { mock: { calls: unknown[][] } }, index: number): [string, RequestInit] {
	return fetchImpl.mock.calls[index] as unknown as [string, RequestInit]
}

describe("OtlpTransport delivery", () => {
	it("posts queued events to the configured endpoint as one batch", async () => {
		const fetchImpl = vi.fn(async () => okResponse())
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
			batchSize: 10,
		})

		transport.enqueue(event(1))
		transport.enqueue(event(2))
		await transport.flush()

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = requestAt(fetchImpl, 0)
		expect(url).toBe("http://127.0.0.1:4318/v1/logs")
		expect(init.method).toBe("POST")
		expect(JSON.parse(String(init.body)).events).toHaveLength(2)
		await transport.dispose()
	})

	it("splits a backlog into batches no larger than the configured size", async () => {
		const fetchImpl = vi.fn(async () => okResponse())
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
			batchSize: 2,
		})

		for (let sequence = 1; sequence <= 5; sequence++) {
			transport.enqueue(event(sequence))
		}
		await transport.flush()

		expect(fetchImpl).toHaveBeenCalledTimes(3)
		await transport.dispose()
	})

	it("sends the pairing token when one is configured", async () => {
		const fetchImpl = vi.fn(async () => okResponse())
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
			token: "pairing-token",
		})

		transport.enqueue(event(1))
		await transport.flush()

		const [, init] = requestAt(fetchImpl, 0)
		const headers = new Headers(init.headers)
		expect(headers.get("authorization")).toBe("Bearer pairing-token")
		await transport.dispose()
	})
})

describe("OtlpTransport failure handling", () => {
	it("does not throw when the collector is unreachable", async () => {
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED")
			},
		})

		transport.enqueue(event(1))
		await expect(transport.flush()).resolves.toBeUndefined()
		expect(transport.stats.failedBatches).toBe(1)
		await transport.dispose()
	})

	it("counts a rejected batch instead of retrying forever", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }))
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
		})

		transport.enqueue(event(1))
		await transport.flush()

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(transport.stats.failedBatches).toBe(1)
		await transport.dispose()
	})

	it("aborts a collector that does not answer within the timeout", async () => {
		let observed: AbortSignal | undefined
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			timeoutMs: 5,
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					observed = init?.signal ?? undefined
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
				}),
		})

		transport.enqueue(event(1))
		await transport.flush()

		expect(observed?.aborted).toBe(true)
		expect(transport.stats.failedBatches).toBe(1)
		await transport.dispose()
	})

	it("drops the oldest events once the queue is full", async () => {
		const fetchImpl = vi.fn(async () => okResponse())
		const transport = new OtlpTransport({
			endpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
			maxQueued: 3,
			batchSize: 100,
		})

		for (let sequence = 1; sequence <= 6; sequence++) {
			transport.enqueue(event(sequence))
		}
		await transport.flush()

		const [, init] = requestAt(fetchImpl, 0)
		const sequences = JSON.parse(String(init.body)).events.map((entry: RuntimeTelemetryEvent) => entry.sequence)
		expect(sequences).toEqual([4, 5, 6])
		expect(transport.stats.droppedEvents).toBe(3)
		await transport.dispose()
	})

	it("stops sending after disposal", async () => {
		const fetchImpl = vi.fn(async () => okResponse())
		const transport = new OtlpTransport({ endpoint: "http://127.0.0.1:4318/v1/logs", fetchImpl })

		await transport.dispose()
		transport.enqueue(event(1))
		await transport.flush()

		expect(fetchImpl).not.toHaveBeenCalled()
	})
})
