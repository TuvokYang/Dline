import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import * as path from "node:path"
import { DlineTempManager } from "@services/temp"
import { describe, it } from "vitest"
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
	it("creates the activity-owned log only after output exceeds the configured line limit", async () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]
		let logFilePath: string | undefined
		const expectedLogPath = path.join(DlineTempManager.getTempDir(), "command_100_1.log")
		manager.setTerminalOutputLineLimit(2)
		await fs.rm(expectedLogPath, { force: true })

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_1", [], undefined, {
				onLogFileCreated: (createdPath) => {
					logFilePath = createdPath
				},
			})

			process.emit("line", "one", "stdout")
			process.emit("line", "two", "stderr")
			assert.equal(command.logFilePath, undefined)
			process.emit("line", "three", "stdout")
			process.emit("completed", { exitCode: 0, signal: null })

			assert.equal(path.basename(command.logFilePath ?? ""), "command_100_1.log")
			assert.equal(logFilePath, command.logFilePath)
			assert.equal(await manager.readBackgroundCommandOutput(command.id), "[O] one\n[E] two\n[O] three\n")
		} finally {
			manager.disposeBackgroundCommands()
			await fs.rm(expectedLogPath, { force: true })
		}
	})

	it("keeps small completed background output in memory", async () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_small")
			process.emit("line", "small output", "stdout")
			process.emit("completed", { exitCode: 0, signal: null })

			assert.equal(command.logFilePath, undefined)
			assert.equal(await manager.readBackgroundCommandOutput(command.id), "[O] small output")
		} finally {
			manager.disposeBackgroundCommands()
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
