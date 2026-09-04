import { RuntimeEventBus, type RuntimeEventBusOptions } from "./runtime-event-bus"
import { RuntimeEventPriority, type RuntimeTelemetryContext } from "./types"

export { AttributeRejection, RuntimeContentPolicy, runtimeContentPolicyLimits } from "./content-policy"
export { normalizeRuntimeError } from "./error-normalizer"
export { RuntimeEventBus, type RuntimeEventBusOptions } from "./runtime-event-bus"
export { RuntimeTelemetryContextHolder, type RuntimeTelemetryScope } from "./runtime-telemetry-context"
export { RuntimeTelemetryLifecycle, type RuntimeTelemetryLifecycleOptions } from "./runtime-telemetry-lifecycle"
export { RuntimeTelemetryService, type RuntimeTelemetryServiceOptions } from "./runtime-telemetry-service"
export { OtlpTransport, type OtlpTransportOptions, type OtlpTransportStats } from "./transports/otlp-transport"
export { PairingAuthorization, PairingRejection } from "./transports/pairing-authorization"
export { SessionJournal, type SessionJournalOptions, type SessionJournalStats } from "./transports/session-journal"
export {
	type NormalizedRuntimeError,
	type RuntimeAttributes,
	type RuntimeAttributeValue,
	type RuntimeDropAccounting,
	RuntimeDropReason,
	type RuntimeEventInput,
	RuntimeEventPriority,
	type RuntimeEventSubscriber,
	type RuntimeTelemetryContext,
	type RuntimeTelemetryEvent,
} from "./types"

/**
 * Process-wide runtime telemetry entry point.
 *
 * Producers are spread across services that have no shared owner, so the bus
 * is reachable through a module-level accessor rather than threaded through
 * every constructor. Tests replace it with `setRuntimeTelemetryBus`.
 */

let bus: RuntimeEventBus | undefined

export function getRuntimeTelemetryBus(): RuntimeEventBus {
	if (!bus) bus = new RuntimeEventBus()
	return bus
}

/** Install a bus, returning the previous one so a test can restore it. */
export function setRuntimeTelemetryBus(next: RuntimeEventBus | undefined): RuntimeEventBus | undefined {
	const previous = bus
	bus = next
	return previous
}

export function createRuntimeTelemetryBus(options?: RuntimeEventBusOptions): RuntimeEventBus {
	return new RuntimeEventBus(options)
}

/**
 * Record a phase measurement.
 *
 * `durationMs` is the reason this helper exists: performance producers all
 * report the same shape, and giving them one entry point keeps the attribute
 * names consistent across domains.
 */
export function recordRuntimePhase(
	name: string,
	durationMs: number,
	attributes?: Readonly<Record<string, unknown>>,
	context?: Partial<RuntimeTelemetryContext>,
): void {
	getRuntimeTelemetryBus().record({
		name,
		priority: RuntimeEventPriority.Performance,
		attributes: { ...attributes, durationMs: Math.round(durationMs) },
		context,
	})
}

/** Record a failure that the extension recovered from or surfaced to the user. */
export function recordRuntimeFailure(
	name: string,
	error: unknown,
	attributes?: Readonly<Record<string, unknown>>,
	context?: Partial<RuntimeTelemetryContext>,
): void {
	getRuntimeTelemetryBus().record({
		name,
		priority: RuntimeEventPriority.Error,
		attributes,
		error,
		context,
	})
}
