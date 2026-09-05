import child_process from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ScenarioStep } from "../../export/bundle-builder"
import { FakeReplayPort, RejectingReplayPort, ReplayEffect, ReplayNotPermitted, type ReplayPort } from "../replay-ports"
import { classifyStepEffect, replayScenario } from "../scenario-runner"

function step(overrides: Partial<ScenarioStep> & Pick<ScenarioStep, "index" | "component">): ScenarioStep {
	return {
		operation: "run",
		outcome: "observed",
		offsetMs: 0,
		...overrides,
	}
}

describe("classifyStepEffect", () => {
	it("maps known components to their effect category", () => {
		expect(classifyStepEffect("terminal")).toBe(ReplayEffect.Command)
		expect(classifyStepEffect("mcp")).toBe(ReplayEffect.McpTool)
		expect(classifyStepEffect("provider")).toBe(ReplayEffect.Network)
		expect(classifyStepEffect("checkpoint")).toBe(ReplayEffect.FileWrite)
	})

	it("classifies an unknown component as unknown rather than guessing", () => {
		// A newly instrumented domain — or a component name invented by a
		// hostile bundle — must not inherit the permissions of a reviewed
		// category.
		expect(classifyStepEffect("brand-new-domain")).toBe(ReplayEffect.Unknown)
	})
})

describe("replayScenario", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("routes every step through the injected port", () => {
		const port = new FakeReplayPort()
		const steps = [
			step({ index: 0, component: "terminal", operation: "execute", outcome: "failed", durationMs: 1200 }),
			step({ index: 1, component: "mcp", operation: "callTool", outcome: "recovered", durationMs: 30 }),
		]

		const report = replayScenario(steps, port)

		expect(port.callCount).toBe(2)
		expect(report.steps).toHaveLength(2)
		expect(report.totalRecordedDurationMs).toBe(1230)
	})

	it("performs no real command, tool, network, or file work", () => {
		// Spying on the actual effect surfaces means the assertion fails if a
		// future implementation grows a bypass, instead of only proving that a
		// cooperative fake reported `simulated`.
		const spawn = vi.spyOn(child_process, "spawn")
		const exec = vi.spyOn(child_process, "exec")
		const writeFileSync = vi.spyOn(fs, "writeFileSync")
		const createWriteStream = vi.spyOn(fs, "createWriteStream")
		const connect = vi.spyOn(net, "connect")
		const fetchSpy = vi.spyOn(globalThis, "fetch")

		const port = new FakeReplayPort()
		const steps = [
			step({ index: 0, component: "terminal", operation: "execute", outcome: "failed" }),
			step({ index: 1, component: "mcp", operation: "callTool", outcome: "failed" }),
			step({ index: 2, component: "provider", operation: "stream", outcome: "failed" }),
			step({ index: 3, component: "checkpoint", operation: "commit", outcome: "failed" }),
		]

		const report = replayScenario(steps, port)

		expect(report.steps.every((replayed) => replayed.simulated)).toBe(true)
		expect(port.countFor(ReplayEffect.Command)).toBe(1)
		expect(port.countFor(ReplayEffect.McpTool)).toBe(1)
		expect(port.countFor(ReplayEffect.Network)).toBe(1)
		expect(port.countFor(ReplayEffect.FileWrite)).toBe(1)

		for (const spy of [spawn, exec, writeFileSync, createWriteStream, connect, fetchSpy]) {
			expect(spy).not.toHaveBeenCalled()
		}
	})

	it("refuses to replay an unclassified component", () => {
		// Fail closed: the port is never even asked, so a permissive port
		// cannot turn an unreviewed component into a performed effect.
		const port = new FakeReplayPort()

		expect(() => replayScenario([step({ index: 0, component: "brand-new-domain" })], port)).toThrow(ReplayNotPermitted)
		expect(port.callCount).toBe(0)
	})

	it("never forwards free-form payloads to the port", () => {
		const port = new FakeReplayPort()

		replayScenario([step({ index: 0, component: "terminal", operation: "execute", outcome: "failed" })], port)

		const request = port.requests[0]
		expect(Object.keys(request).sort()).toEqual(["component", "effect", "operation", "recordedDurationMs", "recordedOutcome"])
	})

	it("reports the recorded outcome when the port replays it", () => {
		const port = new FakeReplayPort()
		const report = replayScenario([step({ index: 0, component: "terminal", outcome: "failed" })], port)

		expect(report.steps[0].replayedOutcome).toBe("failed")
		expect(report.divergences).toEqual([])
	})

	it("records a divergence when the port returns a different outcome", () => {
		const port: ReplayPort = {
			perform: () => ({ outcome: "recovered", durationMs: 5, simulated: true as const }),
		}

		const report = replayScenario([step({ index: 7, component: "terminal", outcome: "failed" })], port)

		expect(report.divergences).toEqual([7])
	})

	it("fails loudly when replay is not permitted", () => {
		const port = new RejectingReplayPort()

		expect(() => replayScenario([step({ index: 0, component: "terminal" })], port)).toThrow(ReplayNotPermitted)
	})

	it("returns an empty report for an empty scenario", () => {
		const port = new FakeReplayPort()
		const report = replayScenario([], port)

		expect(report.steps).toEqual([])
		expect(report.totalRecordedDurationMs).toBe(0)
		expect(port.callCount).toBe(0)
	})
})
