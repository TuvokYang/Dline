import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DiagnosisConfidence, RootCauseCategory, type RootCauseDiagnosis } from "../../analysis/root-cause-types"
import { getRuntimeTelemetryBus, recordRuntimePhase, setRuntimeTelemetryBus } from "../../index"
import type { RuntimeEventBus } from "../../runtime-event-bus"
import { activateRuntimeTelemetry, deactivateRuntimeTelemetry } from "../../runtime-telemetry-activation"
import { getDiagnosticSource, getRuntimeTelemetryLifecycle, recordRuntimeDiagnosis } from "../../runtime-telemetry-host"

/**
 * RTD-004 — activation is what makes the pipeline observable from the host.
 *
 * The property worth pinning is the one that silently breaks: producers record
 * through the process-wide bus, so a pipeline draining a *different* bus would
 * still pass every unit test of its own parts while exporting nothing the
 * extension actually measured.
 */

function stubDiagnosis(id: string): RootCauseDiagnosis {
	return {
		incidentId: id,
		category: RootCauseCategory.Unknown,
		confidence: DiagnosisConfidence.Low,
		component: "runtime",
		operation: "probe",
		evidenceEventIds: [],
		missingEvidence: [],
		failingEventId: `${id}-event`,
		reproductionSteps: [],
	}
}

describe("runtime telemetry activation", () => {
	let dataDir: string
	let previousBus: RuntimeEventBus | undefined

	beforeEach(() => {
		dataDir = mkdtempSync(path.join(tmpdir(), "dline-activation-"))
		// Each test starts from a bus it owns, and the original is restored so a
		// suite sharing this process is unaffected.
		previousBus = setRuntimeTelemetryBus(undefined)
	})

	afterEach(async () => {
		await deactivateRuntimeTelemetry()
		setRuntimeTelemetryBus(previousBus)
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("drains the process-wide bus so existing producers reach the export", async () => {
		await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled", sessionId: "activation-session" })
		recordRuntimePhase("activation.probe", 7, { component: "runtime", operation: "probe" })

		const source = getDiagnosticSource()
		expect(source?.sessionId).toBe("activation-session")
		expect(source?.events().map((event) => event.name)).toContain("activation.probe")
		// Activation installs a bus stamped with the session id, so what matters
		// is that producers and the pipeline share one instance — not that the
		// instance predates activation.
		expect(
			getRuntimeTelemetryBus()
				.peek()
				.map((event) => event.context.sessionId),
		).toContain("activation-session")
	})

	it("honours a declined consent by keeping the pipeline stopped", async () => {
		const lifecycle = await activateRuntimeTelemetry({ dataDir, telemetrySetting: "disabled" })

		expect(lifecycle.isEnabled).toBe(false)
		expect(getRuntimeTelemetryLifecycle()).toBe(lifecycle)
	})

	it("treats an undecided user as not yet consented", async () => {
		const lifecycle = await activateRuntimeTelemetry({ dataDir, telemetrySetting: "unset" })

		expect(lifecycle.isEnabled).toBe(false)
	})

	it("replaces an installed pipeline instead of leaving two draining one bus", async () => {
		const first = await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled", sessionId: "first" })
		const second = await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled", sessionId: "second" })

		expect(first).not.toBe(second)
		expect(getRuntimeTelemetryLifecycle()).toBe(second)
		expect(getDiagnosticSource()?.sessionId).toBe("second")
		// The successor built a fresh bus, so recording still lands somewhere the
		// installed pipeline can drain.
		recordRuntimePhase("activation.after-replace", 3, { component: "runtime", operation: "probe" })
		expect(
			getDiagnosticSource()
				?.events()
				.map((event) => event.name),
		).toContain("activation.after-replace")
	})

	it("uninstalls the pipeline and drops diagnoses on shutdown", async () => {
		await activateRuntimeTelemetry({ dataDir, telemetrySetting: "enabled" })
		recordRuntimeDiagnosis(stubDiagnosis("incident-1"))
		expect(getDiagnosticSource()?.diagnoses()).toHaveLength(1)

		await deactivateRuntimeTelemetry()

		expect(getRuntimeTelemetryLifecycle()).toBeUndefined()
		expect(getDiagnosticSource()).toBeUndefined()
	})

	it("is safe to shut down when nothing was ever started", async () => {
		await expect(deactivateRuntimeTelemetry()).resolves.toBeUndefined()
	})
})
