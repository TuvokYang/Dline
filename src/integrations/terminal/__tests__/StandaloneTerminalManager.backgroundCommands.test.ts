import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import * as path from "node:path"
import { DlineTempManager } from "@services/temp"
import { afterEach, describe, it, vi } from "vitest"
import { StandaloneTerminalManager } from "../standalone/StandaloneTerminalManager"
import type { BackgroundCommand } from "../types"

/**
 * Create a background command record for state transition tests.
 * @param id Command identifier.
 * @returns Background command record with pending injection state.
 */
function createCommand(id: string): BackgroundCommand {
	return {
		id,
		command: "npm test",
		startTime: Date.now(),
		status: "completed",
		origin: "explicit_background",
		cancellationOwner: "explicit",
		logFilePath: "logs/command.log",
		lineCount: 1,
		injectionState: "pending",
		process: {} as BackgroundCommand["process"],
	}
}

describe("StandaloneTerminalManager background command injection state", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("uses the original command deadline instead of restarting a fixed timeout at handoff", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(10_000)
		const manager = new StandaloneTerminalManager()
		const terminate = vi.fn()
		const process = Object.assign(new EventEmitter(), { terminate }) as unknown as BackgroundCommand["process"]

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_deadline", [], {
				origin: "foreground",
				cancellationOwner: "task",
				startedAt: 0,
				deadlineAt: 60_000,
			})

			await vi.advanceTimersByTimeAsync(49_999)
			assert.equal(command.status, "running")
			assert.equal(terminate.mock.calls.length, 0)

			await vi.advanceTimersByTimeAsync(1)
			assert.equal(command.status, "timed_out")
			assert.equal(terminate.mock.calls.length, 1)
		} finally {
			manager.disposeBackgroundCommands()
		}
	})

	it("creates the activity-owned log when background tracking starts", async () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]
		let logFilePath: string | undefined
		const expectedLogPath = path.join(DlineTempManager.getTempDir(), "command_100_1.log")
		await fs.rm(expectedLogPath, { force: true })

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_1", [], undefined, {
				onLogFileCreated: (createdPath) => {
					logFilePath = createdPath
				},
			})

			assert.equal(path.basename(command.logFilePath ?? ""), "command_100_1.log")
			assert.equal(logFilePath, command.logFilePath)
			process.emit("line", "one", "stdout")
			process.emit("line", "two", "stderr")
			process.emit("line", "three", "stdout")
			process.emit("completed", { exitCode: 0, signal: null })

			assert.equal(await manager.readBackgroundCommandOutput(command.id), "[O] one\n[E] two\n[O] three\n")
		} finally {
			manager.disposeBackgroundCommands()
			await fs.rm(expectedLogPath, { force: true })
		}
	})

	it("persists small completed background output to its activity-owned log", async () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]
		const expectedLogPath = path.join(DlineTempManager.getTempDir(), "command_100_small.log")
		await fs.rm(expectedLogPath, { force: true })

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_small")
			process.emit("line", "small output", "stdout")
			process.emit("completed", { exitCode: 0, signal: null })

			assert.equal(command.logFilePath, expectedLogPath)
			assert.equal(await manager.readBackgroundCommandOutput(command.id), "[O] small output\n")
		} finally {
			manager.disposeBackgroundCommands()
			await fs.rm(expectedLogPath, { force: true })
		}
	})

	it("classifies a background completion without an exit code as an error", () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_2")
			process.emit("completed", { exitCode: undefined, signal: null })

			assert.equal(command.status, "error")
		} finally {
			manager.disposeBackgroundCommands()
		}
	})

	it("moves background command injection state forward only", () => {
		const manager = new StandaloneTerminalManager()
		const managerState = manager as unknown as { backgroundCommands: Map<string, BackgroundCommand> }
		const command = createCommand("command_1")
		managerState.backgroundCommands.set(command.id, command)

		manager.markBackgroundCommandsConsumed([command.id])
		assert.equal(manager.getBackgroundCommand(command.id)?.injectionState, "pending")

		manager.markBackgroundCommandsInjected([command.id])
		assert.equal(manager.getBackgroundCommand(command.id)?.injectionState, "injected")

		manager.markBackgroundCommandsConsumed([command.id])
		assert.equal(manager.getBackgroundCommand(command.id)?.injectionState, "consumed")

		manager.markBackgroundCommandsInjected([command.id])
		assert.equal(manager.getBackgroundCommand(command.id)?.injectionState, "consumed")
	})
})
