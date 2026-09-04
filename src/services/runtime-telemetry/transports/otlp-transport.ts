import { fetch as proxyAwareFetch } from "@/shared/net"
import type { RuntimeTelemetryEvent } from "../types"

/**
 * Ships runtime telemetry to a locally configured OTLP collector.
 *
 * Everything here exists to keep diagnostics from becoming a liability. A
 * collector that is stopped, wedged, or slow is the normal case on a developer
 * machine, so the transport never blocks a producer, never retries
 * indefinitely, and drops its oldest backlog rather than growing without
 * bound. Failures are counted so the settings view can say "not delivering"
 * instead of silently appearing healthy.
 *
 * The default fetch comes from `@/shared/net` because the extension must honour
 * the user's proxy configuration on every host, including JetBrains and CLI
 * where the global fetch does not.
 */

const DEFAULT_BATCH_SIZE = 64
const DEFAULT_MAX_QUEUED = 1_000
const DEFAULT_TIMEOUT_MS = 3_000

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface OtlpTransportOptions {
	readonly endpoint: string
	/** Pairing token presented to the collector, when one was redeemed. */
	readonly token?: string
	readonly batchSize?: number
	readonly maxQueued?: number
	readonly timeoutMs?: number
	/** Injectable for tests; defaults to the proxy-aware fetch. */
	readonly fetchImpl?: FetchLike
}

export interface OtlpTransportStats {
	readonly sentEvents: number
	readonly failedBatches: number
	/** Events discarded because the queue was already full. */
	readonly droppedEvents: number
}

export class OtlpTransport {
	private readonly endpoint: string
	private readonly token: string | undefined
	private readonly batchSize: number
	private readonly maxQueued: number
	private readonly timeoutMs: number
	private readonly fetchImpl: FetchLike

	private readonly queue: RuntimeTelemetryEvent[] = []
	private sentEvents = 0
	private failedBatches = 0
	private droppedEvents = 0
	private disposed = false
	private inFlight: Promise<void> | undefined

	constructor(options: OtlpTransportOptions) {
		this.endpoint = options.endpoint
		this.token = options.token
		this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
		this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.fetchImpl = options.fetchImpl ?? (proxyAwareFetch as FetchLike)
	}

	get stats(): OtlpTransportStats {
		return { sentEvents: this.sentEvents, failedBatches: this.failedBatches, droppedEvents: this.droppedEvents }
	}

	/**
	 * Queue an event for delivery.
	 *
	 * When the queue is full the oldest events go first: a stalled collector
	 * should cost the beginning of the backlog, not the events describing what
	 * is happening right now.
	 */
	enqueue(event: RuntimeTelemetryEvent): void {
		if (this.disposed) return
		this.queue.push(event)
		if (this.queue.length > this.maxQueued) {
			const overflow = this.queue.length - this.maxQueued
			this.queue.splice(0, overflow)
			this.droppedEvents += overflow
		}
	}

	/** Deliver everything queued. Never rejects. */
	async flush(): Promise<void> {
		if (this.disposed) return
		// Serialize flushes so batches reach the collector in queue order.
		this.inFlight = (this.inFlight ?? Promise.resolve()).then(() => this.drain())
		return this.inFlight
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		await this.inFlight
		this.disposed = true
		this.queue.length = 0
	}

	private async drain(): Promise<void> {
		while (this.queue.length > 0 && !this.disposed) {
			const batch = this.queue.splice(0, this.batchSize)
			await this.send(batch)
		}
	}

	private async send(batch: readonly RuntimeTelemetryEvent[]): Promise<void> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.timeoutMs)
		timer.unref?.()

		try {
			const response = await this.fetchImpl(this.endpoint, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify({ events: batch }),
				signal: controller.signal,
			})
			if (!response.ok) {
				// A rejected batch is dropped rather than retried: the events
				// are already in the session journal, and a retry loop against
				// a broken collector would be its own performance problem.
				this.failedBatches += 1
				return
			}
			this.sentEvents += batch.length
		} catch {
			this.failedBatches += 1
		} finally {
			clearTimeout(timer)
		}
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (this.token) headers.authorization = `Bearer ${this.token}`
		return headers
	}
}
