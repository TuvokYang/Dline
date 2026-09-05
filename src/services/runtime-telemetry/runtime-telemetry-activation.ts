import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { createRuntimeTelemetryBus, setRuntimeTelemetryBus } from "./index"
import { configurePerfRecorder, resetPerfRecorder } from "./instrumentation/duration-recorder"
import { clearRuntimeDiagnoses, recordRuntimeDiagnosis, setRuntimeTelemetryLifecycle } from "./runtime-telemetry-host"
import { RuntimeTelemetryLifecycle } from "./runtime-telemetry-lifecycle"

/**
 * Starts and stops the runtime telemetry pipeline for one extension host.
 *
 * The activation lives here rather than in `common.ts` so the startup path only
 * states *when* telemetry starts, while *how* it starts — which bus it drains,
 * where the journal goes, how consent is applied — stays inside this package.
 *
 * The lifecycle is given the process-wide bus rather than the private one it
 * would otherwise create. Producers across the extension record through
 * `getRuntimeTelemetryBus()`; if the pipeline drained a different bus, every
 * one of those measurements would be invisible to the journal, the collector
 * and the diagnostic export, and the export would contain only the sampler's
 * own breach events.
 *
 * That bus is built here rather than taken from the lazy accessor so it can
 * carry the session id. A bus left to its own default stamps events with a
 * private identifier that has nothing to do with the journal file name, which
 * makes a bundle impossible to line up with the journal it came from.
 */

/** Identifies one extension host run; scopes the journal file and the export. */
function createSessionId(now: Date): string {
	const stamp = now.toISOString().replaceAll(/[:.]/g, "-")
	// A random suffix keeps two hosts started in the same millisecond apart.
	const suffix = Math.random().toString(36).slice(2, 8)
	return `${stamp}-${suffix}`
}

export interface RuntimeTelemetryActivationOptions {
	/** Root of the Dline data directory; the journal lives under `telemetry/`. */
	readonly dataDir: string
	/** The user's current reporting choice. */
	readonly telemetrySetting: TelemetrySetting
	readonly sessionId?: string
}

/**
 * Install and start the pipeline, replacing any pipeline already installed.
 *
 * Returns the lifecycle so a caller can apply later consent changes. Failure to
 * start is not propagated by design: diagnostics are an aid, and an extension
 * that cannot activate because its telemetry failed would be strictly worse
 * than one running without it.
 */
export async function activateRuntimeTelemetry(options: RuntimeTelemetryActivationOptions): Promise<RuntimeTelemetryLifecycle> {
	// Replacing an existing pipeline would orphan its open sinks, so shut the
	// previous one down before installing a successor.
	await deactivateRuntimeTelemetry()

	const sessionId = options.sessionId ?? createSessionId(new Date())
	const bus = createRuntimeTelemetryBus({ sessionId })
	setRuntimeTelemetryBus(bus)

	const lifecycle = new RuntimeTelemetryLifecycle({
		dataDir: options.dataDir,
		sessionId,
		bus,
		// Diagnoses go to the process-wide store the export reads, and are
		// also recorded as events so the session journal carries the
		// conclusion next to the evidence it was drawn from.
		onDiagnosis: (diagnosis) => {
			recordRuntimeDiagnosis(diagnosis)
			lifecycle.service.recordInfo("runtime.diagnosis", {
				component: "runtime",
				operation: "diagnose",
				incidentId: diagnosis.incidentId,
				category: diagnosis.category,
				confidence: diagnosis.confidence,
				failingEventId: diagnosis.failingEventId,
			})
		},
	})
	setRuntimeTelemetryLifecycle(lifecycle)

	// The ~70 instrumented call sites ask this predicate before they read a
	// clock or build an attribute object. Left unconfigured it answers "yes"
	// for the whole host, so an undecided or opted-out user would still pay
	// for measurements nothing is allowed to report.
	configurePerfRecorder({ enabled: () => lifecycle.isEnabled })

	await lifecycle.applyConsent(options.telemetrySetting)
	return lifecycle
}

/**
 * Stop and uninstall the pipeline.
 *
 * Safe to call when nothing is installed, which is the normal case for hosts
 * that never activated telemetry and for a second deactivation during shutdown.
 */
export async function deactivateRuntimeTelemetry(): Promise<void> {
	const previous = setRuntimeTelemetryLifecycle(undefined)
	clearRuntimeDiagnoses()
	if (!previous) {
		// Nothing was collecting, but a recorder may still point at a pipeline
		// from an earlier host; restoring the default keeps the two in step.
		resetPerfRecorder()
		return
	}

	// `dispose` flushes before closing, so events recorded up to shutdown still
	// reach the journal. Until it returns the predicate must keep answering for
	// the pipeline being torn down, so it is reset afterwards.
	await previous.dispose()
	// Restoring the default would re-enable recording, so the recorder is
	// pinned off: after deactivation there is no pipeline to report to.
	configurePerfRecorder({ enabled: () => false })
	// The lifecycle disposed the shared bus it was given; drop the reference so
	// a later activation builds a fresh one instead of recording into a
	// disposed queue.
	setRuntimeTelemetryBus(undefined)
}
