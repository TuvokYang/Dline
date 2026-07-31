import assert from "node:assert/strict"
import { afterEach, describe, it, vi } from "vitest"
import { WINDOWS_POWERSHELL_LEGACY_PATH } from "@/utils/shell"
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

	it("uses Windows PowerShell for the default background shell", () => {
		const originalPlatform = process.platform
		try {
			Object.defineProperty(process, "platform", { value: "win32" })
			const terminalProcess = new StandaloneTerminalProcess()
			const internals = terminalProcess as unknown as {
				getDefaultShell(): string
				getShellArgs(shell: string, command: string): string[]
			}

			assert.equal(internals.getDefaultShell(), WINDOWS_POWERSHELL_LEGACY_PATH)
			assert.deepEqual(internals.getShellArgs(internals.getDefaultShell(), "Get-Location"), ["-Command", "Get-Location"])
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform })
		}
	})
})
