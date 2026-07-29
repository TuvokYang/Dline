import assert from "node:assert/strict"
import { afterEach, describe, it, vi } from "vitest"
import { StandaloneTerminalProcess } from "./StandaloneTerminalProcess"

afterEach(() => {
	vi.useRealTimers()
})

describe("StandaloneTerminalProcess output streams", () => {
	it("keeps partial stdout and stderr lines in independent buffers", () => {
		vi.useFakeTimers()
		const process = new StandaloneTerminalProcess()
		const emitted: Array<{ line: string; stream: string }> = []
		;(process.on as (...args: unknown[]) => typeof process)("line", (line: string, stream: string) => {
			emitted.push({ line, stream })
		})
		const internals = process as unknown as {
			handleOutput(data: string, stream: "stdout" | "stderr"): void
		}

		internals.handleOutput("stdout partial", "stdout")
		internals.handleOutput("stderr line\n", "stderr")
		internals.handleOutput(" complete\n", "stdout")

		assert.deepEqual(emitted, [
			{ line: "stderr line", stream: "stderr" },
			{ line: "stdout partial complete", stream: "stdout" },
		])
	})
})
