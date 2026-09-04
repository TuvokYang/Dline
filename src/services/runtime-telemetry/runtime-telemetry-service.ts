import { RuntimeEventBus } from "./runtime-event-bus"
import type { RuntimeTelemetryScope } from "./runtime-telemetry-context"
import {
	RuntimeEventPriority,
	type RuntimeEventSubscriber,
	type RuntimeTelemetryContext,
	type RuntimeTelemetryEvent,
} from "./types"

/**
 * The entry point producers use to report runtime behaviour.
 *
 * The bus decides ordering, content policy, and back pressure; this service
 * decides what a producer is allowed to express and whether the user's
 * telemetry choice permits recording it. Keeping the two apart means the
 * privacy gate can change without touching queue semantics, and the queue can
 * be tested without a settings source.
 */

/** Outcome attribute shared by every measured span. */
const OUTCOME_ATTRIBUTE = "outcome"

type MeasurementOutcome = "success" | "failure"

export interface RuntimeTelemetryServiceOptions {
	readonly bus: RuntimeEventBus
	/**
	 * Whether ordinary recording is permitted.
	 *
	 * Read on every call rather than captured once, because the user can change
	 * the telemetry setting while the extension host is running.
	 */
	readonly enabled?: () => boolean
	/** Monotonic clock, injectable so tests do not depend on wall time. */
	readonly now?: () => number
}

export class RuntimeTelemetryService {
	private readonly bus: RuntimeEventBus
	private readonly isEnabled: () => boolean
	private readonly now: () => number

	constructor(options: RuntimeTelemetryServiceOptions) {
		this.bus = options.bus
		this.isEnabled = options.enabled ?? (() => true)
		this.now = options.now ?? (() => performance.now())
	}

	/** Run `work` and record how long it took, then rethrow any failure. */
	async measure<T>(
		name: string,
		work: () => Promise<T>,
		attributes?: Readonly<Record<string, unknown>>,
		context?: Partial<RuntimeTelemetryContext>,
	): Promise<T> {
		const startedAt = this.now()
		try {
			const result = await work()
			this.recordSpan(name, startedAt, "success", attributes, undefined, context)
			return result
		} catch (error) {
			this.recordSpan(name, startedAt, "failure", attributes, error, context)
			throw error
		}
	}

	/** Synchronous counterpart of `measure`, for hot paths that never await. */
	measureSync<T>(
		name: string,
		work: () => T,
		attributes?: Readonly<Record<string, unknown>>,
		context?: Partial<RuntimeTelemetryContext>,
	): T {
		const startedAt = this.now()
		try {
			const result = work()
			this.recordSpan(name, startedAt, "success", attributes, undefined, context)
			return result
		} catch (error) {
			this.recordSpan(name, startedAt, "failure", attributes, error, context)
			throw error
		}
	}

	/** Record a duration measured by the caller. */
	recordPhase(
		name: string,
		durationMs: number,
		attributes?: Readonly<Record<string, unknown>>,
		context?: Partial<RuntimeTelemetryContext>,
	): void {
		this.record(
			RuntimeEventPriority.Performance,
			name,
			{ ...attributes, durationMs: Math.round(durationMs) },
			undefined,
			context,
		)
	}

	/** Record diagnostic detail that is useful only while investigating. */
	recordDebug(name: string, attributes?: Readonly<Record<string, unknown>>, context?: Partial<RuntimeTelemetryContext>): void {
		this.record(RuntimeEventPriority.Debug, name, attributes, undefined, context)
	}

	/** Record an ordinary lifecycle transition. */
	recordInfo(name: string, attributes?: Readonly<Record<string, unknown>>, context?: Partial<RuntimeTelemetryContext>): void {
		this.record(RuntimeEventPriority.Info, name, attributes, undefined, context)
	}

	/** Record a failure the extension recovered from or surfaced to the user. */
	recordFailure(
		name: string,
		error: unknown,
		attributes?: Readonly<Record<string, unknown>>,
		context?: Partial<RuntimeTelemetryContext>,
	): void {
		this.record(RuntimeEventPriority.Error, name, attributes, error, context)
	}

	/**
	 * Record a broken internal assumption.
	 *
	 * Invariant breaches bypass the enabled gate: they carry no user content by
	 * construction, and they are the evidence a defect existed at all. Losing
	 * them because telemetry happens to be off would make the class of bug this
	 * service exists to find undiagnosable.
	 */
	recordInvariant(
		name: string,
		attributes?: Readonly<Record<string, unknown>>,
		context?: Partial<RuntimeTelemetryContext>,
	): void {
		this.bus.record({
			name,
			priority: RuntimeEventPriority.Invariant,
			attributes,
			context,
		})
	}

	/**
	 * Make `scope` ambient for everything `fn` reaches.
	 *
	 * The session id is not part of the scope: it belongs to the extension host
	 * process, and a caller entering a task scope must not be able to relabel
	 * which session produced the events.
	 */
	withContext<T>(scope: RuntimeTelemetryScope, fn: () => T): T {
		return this.bus.context.run(scope, fn)
	}

	/** Observe recorded events. Returns an unsubscribe function. */
	onEvent(subscriber: RuntimeEventSubscriber): () => void {
		return this.bus.subscribe(subscriber)
	}

	/** Events currently buffered, oldest first. */
	buffered(): readonly RuntimeTelemetryEvent[] {
		return this.bus.peek()
	}

	get events(): RuntimeEventBus {
		return this.bus
	}

	private recordSpan(
		name: string,
		startedAt: number,
		outcome: MeasurementOutcome,
		attributes: Readonly<Record<string, unknown>> | undefined,
		error: unknown,
		context: Partial<RuntimeTelemetryContext> | undefined,
	): void {
		const spanAttributes = {
			...attributes,
			[OUTCOME_ATTRIBUTE]: outcome,
			durationMs: Math.round(this.now() - startedAt),
		}
		const priority = outcome === "failure" ? RuntimeEventPriority.Error : RuntimeEventPriority.Performance
		this.record(priority, name, spanAttributes, error, context)
	}

	private record(
		priority: RuntimeEventPriority,
		name: string,
		attributes: Readonly<Record<string, unknown>> | undefined,
		error: unknown,
		context: Partial<RuntimeTelemetryContext> | undefined,
	): void {
		if (!this.isEnabled()) return
		this.bus.record({ name, priority, attributes, error, context })
	}
}
