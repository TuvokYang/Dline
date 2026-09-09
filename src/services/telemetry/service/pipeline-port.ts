/**
 * The single contract shared by telemetry producers and the pipeline that records them.
 *
 * Three groups of modules need to reach each other: the instrumentation helpers
 * (`instrumentation/`), the domain recorders (`events/`), and the runtime
 * pipeline (`runtime/`). Wiring them directly produced a cycle — the recorders
 * reached into the runtime bus while the runtime activation reached back into
 * the instrumentation switch — so a change on either side could silently break
 * the other. This port is the only module all three are allowed to depend on,
 * and it depends on nothing, which is what makes the direction enforceable.
 *
 * The port deliberately does not expose the runtime queue's numeric priority.
 * Producers describe *what kind of fact* they are reporting; how the queue
 * orders or evicts that fact is the pipeline's concern and must stay
 * replaceable without touching ~70 instrumented call sites.
 */

/** Kind of fact a signal reports, independent of any queue implementation. */
export type SignalLevel = "debug" | "info" | "performance" | "error" | "invariant"

/** Producer-supplied dimensions. The pipeline applies the content policy. */
export type SignalAttributes = Readonly<Record<string, unknown>>

/**
 * Identity of the work that produced a signal.
 *
 * Every field is optional: a producer supplies only what it knows, and the
 * pipeline fills the rest from its ambient context.
 */
export interface SignalContext {
	readonly sessionId?: string
	readonly taskId?: string
	readonly controllerId?: string
	readonly workspaceId?: string
}

/** One fact handed to the pipeline. */
export interface TelemetrySignal {
	readonly name: string
	readonly level: SignalLevel
	readonly attributes?: SignalAttributes
	readonly error?: unknown
	readonly context?: SignalContext
}

/**
 * What a pipeline must provide to receive signals.
 *
 * `accept` must not throw: a producer reporting a failure cannot be allowed to
 * fail because of the reporting itself.
 */
export interface SignalPipeline {
	accept(signal: TelemetrySignal): void
}

/**
 * Bound on the bootstrap buffer.
 *
 * Startup instrumentation runs before any pipeline exists. Buffering keeps
 * those facts, but an unbounded buffer would turn a pipeline that never
 * arrives into a memory leak.
 *
 * When full, the *oldest* signal is evicted rather than the newest being
 * refused. Overflow means startup is taking far longer than expected, and in
 * that case the recent signals are the ones that describe where it is stuck;
 * the earliest ones only say that it began.
 */
export const BOOTSTRAP_CAPACITY = 256

let pipeline: SignalPipeline | undefined
let recordingEnabled: () => boolean = () => true

const bootstrapBuffer: TelemetrySignal[] = []
let bootstrapDropped = 0

/**
 * Install the pipeline that receives subsequent signals.
 *
 * Swapping the destination is all this does. It deliberately does not touch the
 * bootstrap buffer, in either direction: admitting those facts is a consent
 * decision and discarding them is a session-boundary decision, and both belong
 * to the lifecycle owner. Folding the discard in here made uninstalling — which
 * a first activation does on its way in, before any pipeline exists — silently
 * throw away the startup window it was about to drain.
 *
 * Callers that end a session uninstall and then call
 * `discardBootstrapSignals()` explicitly.
 *
 * Returns the previous pipeline so a caller can restore it.
 */
export function installSignalPipeline(next: SignalPipeline | undefined): SignalPipeline | undefined {
	const previous = pipeline
	pipeline = next
	return previous
}

/**
 * Hand one signal to the pipeline, or buffer it until one is installed.
 *
 * Buffered signals are not auto-flushed on install. Whether early startup
 * facts may be admitted into a session is a consent decision owned by the
 * pipeline lifecycle, not by whichever call site happened to record first.
 */
export function emitSignal(signal: TelemetrySignal): void {
	const target = pipeline
	if (target) {
		target.accept(signal)
		return
	}

	if (bootstrapBuffer.length >= BOOTSTRAP_CAPACITY) {
		bootstrapBuffer.shift()
		bootstrapDropped += 1
	}
	bootstrapBuffer.push(signal)
}

/**
 * Configure whether producers should record at all.
 *
 * A predicate rather than a boolean: the user can change the reporting setting
 * while the extension host runs, and capturing the value once would strand
 * every call site on whichever setting was active at module load.
 */
export function configureSignalRecording(options: { readonly enabled: () => boolean }): void {
	recordingEnabled = options.enabled
}

/** Restore the default predicate. Intended for tests and deactivation. */
export function resetSignalRecording(): void {
	recordingEnabled = () => true
}

/** Whether producers should build and emit signals right now. */
export function isSignalRecordingEnabled(): boolean {
	return recordingEnabled()
}

/** Signals held while no pipeline was installed, plus what did not fit. */
export interface BootstrapSignalDrain {
	readonly signals: readonly TelemetrySignal[]
	readonly dropped: number
}

/**
 * Take everything buffered before a pipeline existed.
 *
 * Exposed for the lifecycle owner, which decides — after consent is known —
 * whether those facts may enter the session.
 */
export function drainBootstrapSignals(): BootstrapSignalDrain {
	const signals = bootstrapBuffer.splice(0, bootstrapBuffer.length)
	const dropped = bootstrapDropped
	bootstrapDropped = 0
	return { signals, dropped }
}

/** Drop everything buffered without delivering it. */
export function discardBootstrapSignals(): void {
	bootstrapBuffer.length = 0
	bootstrapDropped = 0
}

/** How many signals are currently buffered. */
export function bootstrapSignalCount(): number {
	return bootstrapBuffer.length
}
