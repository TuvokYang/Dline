import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import * as path from "node:path"
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
	it("uses the command activity identity for the background record and log stem", () => {
		const manager = new StandaloneTerminalManager()
		const process = new EventEmitter() as BackgroundCommand["process"]

		try {
			const command = manager.trackBackgroundCommand(process, "npm test", "command_100_1")

			assert.equal(command.id, "command_100_1")
			assert.equal(path.basename(command.logFilePath), "command_100_1.log")
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
