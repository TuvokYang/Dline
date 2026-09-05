import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getRuntimeTelemetryBus, setRuntimeTelemetryBus } from "../index"
import { isPerfRecordingEnabled, recordPerfPhase, resetPerfRecorder } from "../instrumentation/duration-recorder"
import { PerfDomain } from "../instrumentation/perf-domains"
import { activateRuntimeTelemetry, deactivateRuntimeTelemetry } from "../runtime-telemetry-activation"

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

describe("activateRuntimeTelemetry", () => {
	let dataDir: string

	beforeEach(() => {
		dataDir = mkdtempSync(path.join(tmpdir(), "dline-activation-"))
		setRuntimeTelemetryBus(undefined)
	})

	afterEach(async () => {
		await deactivateRuntimeTelemetry()
		resetPerfRecorder()
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("keeps the recorder inert while the user has not opted in", async () => {
		await activateRuntimeTelemetry({ dataDir, telemetrySetting: "disabled", sessionId: SESSION_ID })

		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("enables the recorder once reporting is allowed", async () => {
		await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled", sessionId: SESSION_ID })

		expect(isPerfRecordingEnabled()).toBe(true)
	})

	it("follows a later consent change without a restart", async () => {
		const lifecycle = await activateRuntimeTelemetry({
			dataDir,
			telemetrySetting: "disabled",
			sessionId: SESSION_ID,
		})

		await lifecycle.applyConsent("enabled")
		expect(isPerfRecordingEnabled()).toBe(true)

		await lifecycle.applyConsent("disabled")
		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("stops recording once the pipeline is uninstalled", async () => {
		await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled", sessionId: SESSION_ID })
		await deactivateRuntimeTelemetry()

		expect(isPerfRecordingEnabled()).toBe(false)
	})

	it("stamps recorded events with the session id the journal is named after", async () => {
		const lifecycle = await activateRuntimeTelemetry({
			dataDir,
			telemetrySetting: "enabled",
			sessionId: SESSION_ID,
		})

		recordPerfPhase(PerfDomain.TaskInit, "stage", 12)
		const [event] = getRuntimeTelemetryBus().peek()

		expect(lifecycle.sessionId).toBe(SESSION_ID)
		expect(event?.context.sessionId).toBe(SESSION_ID)
	})
})
