import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isPerfRecordingEnabled, recordPerfPhase, resetPerfRecorder } from "../../instrumentation/duration-recorder"
import { PerfDomain } from "../../instrumentation/perf-domains"
import { emitSignal } from "../../service/pipeline-port"
import { activateRuntimeTelemetry, deactivateRuntimeTelemetry } from "../activation"
import { getRuntimeTelemetryBus, setRuntimeTelemetryBus } from "../index"
import { resetRuntimeSignalPipeline } from "../signal-pipeline"

/**
 * Activation is what connects the pipeline to the rest of the extension.
 *
 * Two seams only exist if activation wires them: the recorder's enabled
 * predicate, which decides whether the ~70 instrumented call sites cost
 * anything while reporting is off, and the session id, which has to be the
 * same value in the journal file name and in every event's context or a
 * bundle cannot be traced back to its journal.
 */

const SESSION_ID = "activation-session"

/**
 * Activation without a live collector.
 *
 * Attaching no export processor keeps the transport inert, so a shutdown that
 * has events to flush completes immediately instead of waiting out an OTLP
 * export against an endpoint nothing is listening on. Sampling is off for the
 * same reason these tests do not assert on it: a background verdict would add
 * events unrelated to what each case pins.
 */
function activate(telemetrySetting: TelemetrySetting, dataDir: string) {
	return activateRuntimeTelemetry({
		dataDir,
		telemetrySetting,
		sessionId: SESSION_ID,
		processorFactory: () => undefined,
		samplerIntervalMs: 0,
	})
}

describe("activateRuntimeTelemetry", () => {
	let dataDir: string

	beforeEach(() => {
		dataDir = mkdtempSync(path.join(tmpdir(), "dline-activation-"))
		setRuntimeTelemetryBus(undefined)
	})

	afterEach(async () => {
		await deactivateRuntimeTelemetry()
		resetPerfRecorder()
		// Drop anything still buffered so one case cannot seed the next.
		resetRuntimeSignalPipeline()
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("keeps the recorder inert while the user has not opted in", async () => {
		await activate("disabled", dataDir)

		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("enables the recorder once reporting is allowed", async () => {
		await activate("enabled", dataDir)

		expect(isPerfRecordingEnabled()).toBe(true)
	})

	it("follows a later consent change without a restart", async () => {
		const lifecycle = await activate("disabled", dataDir)

		await lifecycle.applyConsent("enabled")
		expect(isPerfRecordingEnabled()).toBe(true)

		await lifecycle.applyConsent("disabled")
		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("stops recording once the pipeline is uninstalled", async () => {
		await activate("enabled", dataDir)
		await deactivateRuntimeTelemetry()

		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("admits signals recorded before activation once consent allows", async () => {
		// Recorded while no pipeline exists, which is the state every producer
		// that runs before activation is in.
		emitSignal({ name: "startup.before-activation", level: "info" })

		await activate("enabled", dataDir)

		// Activation deactivates any predecessor on its way in. That teardown
		// must not discard the buffer it is about to drain, or the startup
		// window would be permanently invisible.
		expect(
			getRuntimeTelemetryBus()
				.peek()
				.map((event) => event.name),
		).toContain("startup.before-activation")
	})

	it("drops signals recorded before activation when consent is withheld", async () => {
		emitSignal({ name: "startup.before-activation", level: "info" })

		await activate("disabled", dataDir)

		expect(
			getRuntimeTelemetryBus()
				.peek()
				.map((event) => event.name),
		).not.toContain("startup.before-activation")
	})

	it("stamps recorded events with the session id the journal is named after", async () => {
		const lifecycle = await activate("enabled", dataDir)

		recordPerfPhase(PerfDomain.TaskInit, "stage", 12)
		const [event] = getRuntimeTelemetryBus().peek()

		expect(lifecycle.sessionId).toBe(SESSION_ID)
		expect(event?.context.sessionId).toBe(SESSION_ID)
	})
})
