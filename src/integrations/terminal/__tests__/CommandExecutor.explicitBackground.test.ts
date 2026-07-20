import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { describe, it, vi } from "vitest"
import { CommandExecutor } from "../CommandExecutor"
import { StandaloneTerminalManager } from "../standalone/StandaloneTerminalManager"
import type {
	BackgroundCommand,
	CommandExecutorCallbacks,
	ITerminalManager,
	TerminalCompletionDetails,
	TerminalInfo,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "../types"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> {
	isHot = false
	waitForShellIntegration = false
	private readonly resultPromise: Promise<void>
	private resolveResult!: () => void

	constructor() {
		super()
		this.resultPromise = new Promise<void>((resolve) => {
			this.resolveResult = resolve
		})
	}

	continue(): void {
		this.emit("continue")
		this.resolveResult()
	}

	getUnretrievedOutput(): string {
		return ""
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {}
	}

	complete(details: TerminalCompletionDetails): void {
		this.emit("completed", details)
	}

	asResultPromise(): TerminalProcessResultPromise {
		const process = this as unknown as FakeTerminalProcess & Partial<TerminalProcessResultPromise>
		process.then = this.resultPromise.then.bind(this.resultPromise)
		process.catch = this.resultPromise.catch.bind(this.resultPromise)
		process.finally = this.resultPromise.finally.bind(this.resultPromise)
		return process as TerminalProcessResultPromise
	}
}

function createTerminalManager(): ITerminalManager {
	return {
		disposeAll: vi.fn(),
		getOrCreateTerminal: vi.fn(),
		getTerminals: vi.fn(() => []),
		getUnretrievedOutput: vi.fn(() => ""),
		isProcessHot: vi.fn(() => false),
		processOutput: vi.fn((lines: string[]) => lines.join("\n")),
		runCommand: vi.fn(),
		setDefaultTerminalProfile: vi.fn(),
		setShellIntegrationTimeout: vi.fn(),
		setTerminalOutputLineLimit: vi.fn(),
		setTerminalReuseEnabled: vi.fn(),
	}
}

describe("CommandExecutor explicit background execution", () => {
	it.each<readonly [string, TerminalCompletionDetails, "completed" | "failed"]>([
		["explicit zero exit", { exitCode: 0, signal: null }, "completed"],
		["unknown exit code", { exitCode: undefined, signal: null }, "failed"],
	])("routes through a hidden standalone terminal for %s", async (_caseName, completionDetails, expectedStatus) => {
		const process = new FakeTerminalProcess()
		const processPromise = process.asResultPromise()
		const hide = vi.fn()
		const show = vi.fn()
		const terminalInfo: TerminalInfo = {
			id: 1,
			terminal: {
				dispose: vi.fn(),
				hide,
				name: "Background terminal",
				processId: Promise.resolve(1),
				sendText: vi.fn(),
				show,
			},
			busy: false,
			lastActive: Date.now(),
			lastCommand: "",
		}
		const messages: Array<{
			ask: string
			commandStatus: "pending" | "running" | "completed" | "failed"
			logPath?: string
			text: string
			ts: number
		}> = [{ ask: "command", commandStatus: "pending", text: "serve", ts: 101 }]
		const createCommandActivity = vi.fn()
		const updateCommandActivity = vi.fn()
		const callbacks: CommandExecutorCallbacks = {
			addToUserMessageContent: vi.fn(),
			ask: vi.fn(async () => ({ response: "messageResponse" })),
			createCommandActivity,
			getClineMessages: () => messages,
			say: vi.fn(async () => undefined),
			updateBackgroundCommandState: vi.fn(),
			updateClineMessage: vi.fn(async (index, patch) => {
				Object.assign(messages[index], patch)
			}),
			updateCommandActivity,
		}
		const primaryManager = createTerminalManager()
		const executor = new CommandExecutor(
			{
				cwd: "C:\\workspace",
				taskId: "task-1",
				terminalExecutionMode: "vscodeTerminal",
				terminalManager: primaryManager,
				ulid: "task-ulid",
			},
			callbacks,
		)
		const standaloneManager = (executor as unknown as { standaloneManager: StandaloneTerminalManager }).standaloneManager
		const getOrCreateTerminal = vi.spyOn(standaloneManager, "getOrCreateTerminal").mockResolvedValue(terminalInfo)
		const runCommand = vi.spyOn(standaloneManager, "runCommand").mockReturnValue(processPromise)
		const backgroundCommand: BackgroundCommand = {
			command: "serve",
			id: "command_101_1",
			injectionState: "pending",
			lineCount: 0,
			logFilePath: "C:\\Temp\\command_101_1.log",
			process: processPromise,
			startTime: Date.now(),
			status: "running",
		}
		const trackBackgroundCommand = vi.spyOn(standaloneManager, "trackBackgroundCommand").mockReturnValue(backgroundCommand)

		const result = await executor.execute("serve", 30, { commandTs: 101, startInBackground: true })

		assert.equal(vi.mocked(primaryManager.getOrCreateTerminal).mock.calls.length, 0)
		assert.equal(getOrCreateTerminal.mock.calls.length, 1)
		assert.equal(runCommand.mock.calls.length, 1)
		assert.equal(hide.mock.calls.length, 1)
		assert.equal(show.mock.calls.length, 0)
		assert.equal(trackBackgroundCommand.mock.calls.length, 1)
		assert.equal(trackBackgroundCommand.mock.calls[0]?.[2], "command_101_1")
		assert.equal(result.completed, false)
		assert.equal(result.backgroundCommandId, "command_101_1")
		assert.equal(result.logFilePath, "C:\\Temp\\command_101_1.log")
		assert.equal(messages[0].logPath, "C:\\Temp\\command_101_1.log")
		assert.equal(createCommandActivity.mock.calls[0]?.[0].executionMode, "background")
		assert.ok(
			updateCommandActivity.mock.calls.some(
				([, patch]) => patch.executionMode === "background" && patch.logPath === "C:\\Temp\\command_101_1.log",
			),
		)

		process.complete(completionDetails)
		await vi.waitFor(() => {
			assert.ok(updateCommandActivity.mock.calls.some(([, patch]) => patch.status === expectedStatus))
		})
	})
})
