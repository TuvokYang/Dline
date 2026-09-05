import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RuntimeTelemetryLifecycle } from "../runtime-telemetry-lifecycle"

/**
 * The pipeline must reach the journal while the session is still running.
 *
 * `flush` has no caller outside this class, so without a periodic drain the
 * bus would only reach disk at shutdown: it evicts its oldest events once
 * full, and the journal an investigation reads would be empty for the whole
 * session — including a session that ends in a crash and never gets to stop.
 * These tests pin the drain to the behaviour rather than to the timer, so an
 * implementation is free to change how it schedules the work.
 */

const SESSION_ID = "drain-session"

/** Lines the journal holds for this session, or none if it was never created. */
function journaledEventNames(dataDir: string): string[] {
	const journalPath = path.join(dataDir, "telemetry", "sessions", `${SESSION_ID}.jsonl`)
	if (!existsSync(journalPath)) return []
	return readFileSync(journalPath, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line) => String((JSON.parse(line) as { name?: unknown }).name ?? ""))
}

/** Poll instead of sleeping a fixed span: the write path is asynchronous. */
async function waitForJournal(dataDir: string, timeoutMs = 2_000): Promise<string[]> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const names = journaledEventNames(dataDir)
		if (names.length > 0) return names
		if (Date.now() > deadline) return names
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

describe("RuntimeTelemetryLifecycle draining", () => {
	let dataDir: string

	/** Accepts the OTLP post so the transport never becomes the slow path. */
	const fetchImpl = async (): Promise<Response> => new Response(null, { status: 200 })

	function makeLifecycle(overrides: { drainIntervalMs?: number } = {}): RuntimeTelemetryLifecycle {
		return new RuntimeTelemetryLifecycle({
			dataDir,
			sessionId: SESSION_ID,
			fetchImpl,
			// Sampling would add host-dependent events and timing to assertions
			// that only concern the path from bus to journal.
			samplerIntervalMs: 0,
			journalFlushIntervalMs: 5,
			drainIntervalMs: 20,
			...overrides,
		})
	}

	beforeEach(() => {
		dataDir = mkdtempSync(path.join(tmpdir(), "dline-drain-"))
	})

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("writes recorded events to the journal without waiting for shutdown", async () => {
		const lifecycle = makeLifecycle()
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInfo("activation.stage", { component: "runtime", operation: "start" })

		const names = await waitForJournal(dataDir)
		expect(names, "Expected the periodic drain to persist the event").toContain("activation.stage")

		await lifecycle.dispose()
	})

	it("keeps draining across intervals so a long session stays current", async () => {
		const lifecycle = makeLifecycle()
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInfo("activation.stage", { component: "runtime", operation: "start" })
		await waitForJournal(dataDir)

		lifecycle.service.recordInfo("task.step", { component: "task", operation: "run" })
		const deadline = Date.now() + 2_000
		let names = journaledEventNames(dataDir)
		while (!names.includes("task.step") && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10))
			names = journaledEventNames(dataDir)
		}

		expect(names, "A second event must reach the journal without another consent change").toContain("task.step")

		await lifecycle.dispose()
	})

	it("writes nothing while consent is withheld", async () => {
		const lifecycle = makeLifecycle()
		await lifecycle.applyConsent("unset")

		lifecycle.service.recordInfo("activation.stage", { component: "runtime", operation: "start" })
		await new Promise((resolve) => setTimeout(resolve, 100))

		expect(journaledEventNames(dataDir)).toHaveLength(0)

		await lifecycle.dispose()
	})

	it("stops draining once telemetry is turned off", async () => {
		const lifecycle = makeLifecycle()
		await lifecycle.applyConsent("enabled")
		lifecycle.service.recordInfo("activation.stage", { component: "runtime", operation: "start" })
		await waitForJournal(dataDir)

		await lifecycle.applyConsent("disabled")
		const afterStop = journaledEventNames(dataDir)

		// Recording after opt-out must not reappear on disk, and the drain that
		// would have carried it must no longer be running.
		lifecycle.service.recordInfo("task.step", { component: "task", operation: "run" })
		await new Promise((resolve) => setTimeout(resolve, 100))

		expect(journaledEventNames(dataDir)).toEqual(afterStop)

		await lifecycle.dispose()
	})
})
