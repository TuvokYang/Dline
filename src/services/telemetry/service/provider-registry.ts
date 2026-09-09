import type { ClineAccountUserInfo } from "@/services/auth/AuthService"
import { Logger } from "@/shared/services/Logger"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"

/**
 * Owns the set of providers and the fan-out to them.
 *
 * Two concerns live here because they are the same concern seen at different
 * times: *where* a signal is delivered, and *whether delivery is possible yet*.
 * Providers are built asynchronously while the service must be usable from the
 * first synchronous line of activation, so until they arrive this registry
 * holds signals rather than discarding them — otherwise the activation events,
 * which is precisely where startup failures show up, would be the ones lost.
 *
 * Providers also fail for reasons the product cannot control — a network
 * stall, a vendor SDK throwing on shutdown — so every call is isolated. Putting
 * that isolation in one place lets recorders be written as if delivery always
 * succeeds, which is the only way they stay readable.
 */

/**
 * Bound on signals held while providers are still being constructed.
 *
 * Attachment normally completes in well under a second. The bound exists for
 * the case where it never completes at all: a registry that buffered without
 * limit would turn a failed provider factory into a memory leak.
 */
const PENDING_CAPACITY = 512

/**
 * Properties resolved at delivery time rather than at call time.
 *
 * A held signal is delivered after host metadata has been resolved, so the
 * merge must happen then: capturing the merged object when the signal was
 * recorded would stamp every startup event with the placeholder host fields
 * that were current before the host bridge answered.
 */
export type PropertiesThunk = () => TelemetryProperties

/** One delivery deferred until providers exist. */
type PendingDelivery =
	| { kind: "event"; event: string; properties: PropertiesThunk; required: boolean }
	| { kind: "identify"; userInfo: ClineAccountUserInfo; properties: PropertiesThunk }
	| {
			kind: "counter" | "histogram"
			name: string
			value: number
			attributes: PropertiesThunk
			description?: string
			required: boolean
	  }
	| {
			kind: "gauge"
			name: string
			value: number | null
			attributes: PropertiesThunk
			description?: string
			required: boolean
	  }

export class TelemetryProviderRegistry {
	private providers: ITelemetryProvider[]

	/**
	 * Whether providers are final.
	 *
	 * A registry constructed with providers is ready immediately; one that will
	 * receive them later stays pending until `markReady` is called.
	 */
	private ready: boolean
	private closed = false

	private readonly pending: PendingDelivery[] = []
	private pendingDropped = 0

	constructor(providers: ITelemetryProvider[] = [], options: { readonly ready?: boolean } = {}) {
		this.providers = [...providers]
		this.ready = options.ready ?? true
	}

	add(provider: ITelemetryProvider): void {
		if (this.closed) {
			// Adding to a disposed registry would leak the provider's sockets
			// and timers, since nothing will dispose it.
			void provider.dispose().catch(() => {})
			return
		}
		this.providers.push(provider)
	}

	remove(name: string): void {
		this.providers = this.providers.filter((provider) => provider.name !== name)
	}

	/**
	 * Declare providers final and deliver everything held so far, in order.
	 *
	 * Order is preserved because a consumer reading the event stream uses it to
	 * reconstruct what happened during startup.
	 */
	markReady(): void {
		if (this.ready) {
			return
		}
		this.ready = true

		const held = this.pending.splice(0, this.pending.length)
		const dropped = this.pendingDropped
		this.pendingDropped = 0

		for (const delivery of held) {
			this.deliver(delivery)
		}

		if (dropped > 0) {
			// A gap in the startup stream must be visible; silently shorter
			// evidence is worse than evidence that says it is incomplete.
			Logger.warn(`[TelemetryService] Dropped ${dropped} telemetry signal(s) recorded before providers were ready`)
		}
	}

	/** A copy, so a caller iterating cannot be surprised by a concurrent add. */
	list(): ITelemetryProvider[] {
		return [...this.providers]
	}

	get size(): number {
		return this.providers.length
	}

	/** Signals held because providers do not exist yet. */
	get pendingCount(): number {
		return this.pending.length
	}

	isEnabled(): boolean {
		return this.providers.some((provider) => provider.isEnabled())
	}

	/**
	 * Settings reported to callers.
	 *
	 * Taken from the first provider: settings describe the host's telemetry
	 * level, which is a property of the environment rather than of any one
	 * provider. With no providers the answer is "off", which is accurate — no
	 * destination exists.
	 */
	getSettings(): TelemetrySettings {
		return this.providers.length > 0 ? this.providers[0].getSettings() : { hostEnabled: false, level: "off" as const }
	}

	logEvent(event: string, properties: PropertiesThunk, required: boolean): void {
		this.dispatch({ kind: "event", event, properties, required })
	}

	identifyUser(userInfo: ClineAccountUserInfo, properties: PropertiesThunk): void {
		this.dispatch({ kind: "identify", userInfo, properties })
	}

	recordCounter(name: string, value: number, attributes: PropertiesThunk, description?: string, required = false): void {
		this.dispatch({ kind: "counter", name, value, attributes, description, required })
	}

	recordHistogram(name: string, value: number, attributes: PropertiesThunk, description?: string, required = false): void {
		this.dispatch({ kind: "histogram", name, value, attributes, description, required })
	}

	recordGauge(name: string, value: number | null, attributes: PropertiesThunk, description?: string, required = false): void {
		this.dispatch({ kind: "gauge", name, value, attributes, description, required })
	}

	/**
	 * Dispose every provider, waiting for all of them.
	 *
	 * `allSettled` rather than `all`: one provider failing to close must not
	 * leave the others holding sockets or timers open.
	 */
	async dispose(): Promise<void> {
		this.closed = true
		this.pending.length = 0
		this.pendingDropped = 0
		const providers = this.providers
		this.providers = []
		await Promise.allSettled(providers.map((provider) => provider.dispose()))
	}

	/** Deliver now, or hold until providers exist. */
	private dispatch(delivery: PendingDelivery): void {
		if (this.closed) {
			return
		}

		if (this.ready) {
			this.deliver(delivery)
			return
		}

		if (this.pending.length >= PENDING_CAPACITY) {
			// The earliest signals describe activation and are the reason this
			// buffer exists, so the surplus that cannot fit is the newest.
			this.pendingDropped += 1
			return
		}
		this.pending.push(delivery)
	}

	private deliver(delivery: PendingDelivery): void {
		// A snapshot, so a provider that registers or removes another provider
		// while handling this signal cannot change who receives it midway.
		const providers = [...this.providers]
		if (providers.length === 0) {
			return
		}

		// Resolved once per signal rather than once per provider: every
		// provider must see identical properties, and the merge is not free.
		let properties: TelemetryProperties
		try {
			properties = TelemetryProviderRegistry.propertiesOf(delivery)
		} catch (error) {
			Logger.error(`[TelemetryService] Failed to build properties for ${describe(delivery)}:`, error)
			return
		}

		for (const provider of providers) {
			try {
				TelemetryProviderRegistry.applyTo(provider, delivery, properties)
			} catch (error) {
				Logger.error(`[TelemetryService] Provider ${provider.name} failed for ${describe(delivery)}:`, error)
			}
		}
	}

	/**
	 * Resolve the deferred properties of one delivery.
	 *
	 * Deliveries carry a thunk rather than a materialised object so that a
	 * signal recorded before host metadata arrived is still delivered with the
	 * metadata that is current at delivery time.
	 */
	private static propertiesOf(delivery: PendingDelivery): TelemetryProperties {
		switch (delivery.kind) {
			case "event":
			case "identify":
				return delivery.properties()
			case "counter":
			case "histogram":
			case "gauge":
				return delivery.attributes()
			default: {
				const unhandled: never = delivery
				throw new Error(`Unhandled telemetry delivery: ${JSON.stringify(unhandled)}`)
			}
		}
	}

	/**
	 * Apply one delivery to one provider.
	 *
	 * A switch over the discriminant rather than a stored callback so that
	 * adding a delivery kind fails to compile until it is routed.
	 */
	private static applyTo(provider: ITelemetryProvider, delivery: PendingDelivery, properties: TelemetryProperties): void {
		switch (delivery.kind) {
			case "event":
				if (delivery.required) {
					provider.logRequired(delivery.event, properties)
				} else {
					provider.log(delivery.event, properties)
				}
				return
			case "identify":
				provider.identifyUser(delivery.userInfo, properties)
				return
			case "counter":
				provider.recordCounter(delivery.name, delivery.value, properties, delivery.description, delivery.required)
				return
			case "histogram":
				provider.recordHistogram(delivery.name, delivery.value, properties, delivery.description, delivery.required)
				return
			case "gauge":
				provider.recordGauge(delivery.name, delivery.value, properties, delivery.description, delivery.required)
				return
			default: {
				const unhandled: never = delivery
				throw new Error(`Unhandled telemetry delivery: ${JSON.stringify(unhandled)}`)
			}
		}
	}
}

/** Short identifier used only in failure logs. */
function describe(delivery: PendingDelivery): string {
	switch (delivery.kind) {
		case "event":
			return `event ${delivery.event}`
		case "identify":
			return "user identification"
		default:
			return `${delivery.kind} ${delivery.name}`
	}
}
