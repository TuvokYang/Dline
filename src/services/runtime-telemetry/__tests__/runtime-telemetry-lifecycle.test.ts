import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RuntimeTelemetryLifecycle } from "../runtime-telemetry-lifecycle"
import { RuntimeEventPriority } from "../types"

/**
 * RTD-002 — AC-001 / AC-002 / AC-003 / AC-008 / AC-009 / AC-010.
 *
 * The lifecycle is the single place where user consent turns the runtime
 * telemetry pipeline on and off. Everything downstream (journal, OTLP
 * transport, pairing credential) must follow that one decision so a disabled
 * user never produces disk writes or network egress.
 */
describe("RuntimeTelemetryLifecycle", () => {
	let dataDir: string
	let requests: Array<{ url: string; body: string; headers: Record<string, string> }>

	const journalDir = () => path.join(dataDir, "telemetry", "sessions")
	const journalPath = (sessionId: string) => path.join(journalDir(), `${sessionId}.jsonl`)

	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		requests.push({
			url,
			body: String(init?.body ?? ""),
			headers: (init?.headers ?? {}) as Record<string, string>,
		})
		return new Response(null, { status: 200 })
	}

	function createLifecycle(overrides: Partial<ConstructorParameters<typeof RuntimeTelemetryLifecycle>[0]> = {}) {
		return new RuntimeTelemetryLifecycle({
			dataDir,
			sessionId: "session-a",
			otlpEndpoint: "http://127.0.0.1:4318/v1/logs",
			fetchImpl,
			journalFlushIntervalMs: 5,
			...overrides,
		})
	}

	beforeEach(() => {
		dataDir = mkdtempSync(path.join(tmpdir(), "dline-runtime-telemetry-"))
		requests = []
	})

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("stays inert while consent is unset", async () => {
		const lifecycle = createLifecycle()

		await lifecycle.applyConsent("unset")
		lifecycle.service.recordInfo("activation.completed")
		await lifecycle.flush()

		expect(lifecycle.isEnabled).toBe(false)
		expect(existsSync(journalPath("session-a"))).toBe(false)
		expect(requests).toHaveLength(0)
		expect(lifecycle.getStatus().authorizationCodeConfigured).toBe(false)

		await lifecycle.dispose()
	})

	it("issues a pairing credential and starts the pipeline when enabled", async () => {
		const lifecycle = createLifecycle()

		await lifecycle.applyConsent("enabled")

		expect(lifecycle.isEnabled).toBe(true)
		const status = lifecycle.getStatus()
		expect(status.authorizationCodeConfigured).toBe(true)
		expect(status.fingerprint).toMatch(/^[0-9a-f]{12}$/)

		await lifecycle.dispose()
	})

	it("writes enabled events to the session journal and the collector", async () => {
		const lifecycle = createLifecycle()
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInfo("controller.initialized", { controllerCount: 1 })
		await lifecycle.flush()

		const lines = readFileSync(journalPath("session-a"), "utf8").trim().split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).name).toBe("controller.initialized")

		expect(requests).toHaveLength(1)
		const exported = JSON.parse(requests[0].body)
		expect(exported.events[0].name).toBe("controller.initialized")

		await lifecycle.dispose()
	})

	it("never sends the pairing code to the local collector", async () => {
		const lifecycle = createLifecycle()
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInfo("task.started")
		await lifecycle.flush()

		const code = lifecycle.consumePairingCodeForRemoteExchange()
		expect(code).toBeTruthy()

		const transmitted = requests.map((request) => `${JSON.stringify(request.headers)}${request.body}`).join("")
		expect(transmitted).not.toContain(code as string)
		expect(transmitted.toLowerCase()).not.toContain("authorization")

		await lifecycle.dispose()
	})

	it("stops collection, flushes and revokes the unclaimed code when disabled", async () => {
		const lifecycle = createLifecycle()
		await lifecycle.applyConsent("enabled")
		lifecycle.service.recordInfo("before.disable")

		await lifecycle.applyConsent("disabled")

		// The event recorded while enabled is still persisted by the disable flush.
		expect(readFileSync(journalPath("session-a"), "utf8")).toContain("before.disable")
		expect(lifecycle.isEnabled).toBe(false)
		expect(lifecycle.getStatus().authorizationCodeConfigured).toBe(false)

		const requestsAfterDisable = requests.length
		lifecycle.service.recordInfo("after.disable")
		await lifecycle.flush()

		expect(readFileSync(journalPath("session-a"), "utf8")).not.toContain("after.disable")
		expect(requests).toHaveLength(requestsAfterDisable)

		await lifecycle.dispose()
	})

	it("reuses the existing pairing code across a reload while consent stays enabled", async () => {
		const first = createLifecycle()
		await first.applyConsent("enabled")
		const firstFingerprint = first.getStatus().fingerprint
		await first.dispose()

		const second = createLifecycle({ sessionId: "session-b" })
		await second.applyConsent("enabled")

		expect(second.getStatus().fingerprint).toBe(firstFingerprint)

		await second.dispose()
	})

	it("keeps invariant events even when the queue is saturated", async () => {
		const lifecycle = createLifecycle({ capacity: 4 })
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInvariant("state.invariant_violated")
		for (let index = 0; index < 20; index++) {
			lifecycle.service.recordDebug(`debug.${index}`)
		}
		await lifecycle.flush()

		const persisted = readFileSync(journalPath("session-a"), "utf8")
		expect(persisted).toContain("state.invariant_violated")
		expect(lifecycle.dropAccounting.total).toBeGreaterThan(0)

		await lifecycle.dispose()
	})

	it("keeps recording to the journal when the collector is unreachable", async () => {
		const lifecycle = createLifecycle({
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED")
			},
		})
		await lifecycle.applyConsent("enabled")

		lifecycle.service.recordInfo("provider.request_failed")
		await expect(lifecycle.flush()).resolves.toBeUndefined()

		expect(readFileSync(journalPath("session-a"), "utf8")).toContain("provider.request_failed")
		expect(lifecycle.transportStats.failedBatches).toBeGreaterThan(0)

		await lifecycle.dispose()
	})

	it("records performance phases through the shared service", async () => {
		const lifecycle = createLifecycle()
		await lifecycle.applyConsent("enabled")

		await lifecycle.service.measure("state.build", async () => "ok")
		await lifecycle.flush()

		const events = readFileSync(journalPath("session-a"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line))
		const measured = events.find((event) => event.name === "state.build")

		expect(measured).toBeDefined()
		expect(measured.priority).toBe(RuntimeEventPriority.Performance)
		expect(typeof measured.attributes.durationMs).toBe("number")

		await lifecycle.dispose()
	})
})
