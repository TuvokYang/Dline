import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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
	TerminalManagerConfiguration,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "../types"

const terminalConfiguration: TerminalManagerConfiguration = {
	shellIntegrationTimeout: 4000,
	terminalReuseEnabled: true,
	terminalOutputLineLimit: 500,
	defaultTerminalProfile: "default",
}

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> {
	isHot = false
	waitForShellIntegration = false
	readonly terminate = vi.fn()
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
		configure: vi.fn(() => ({ closedCount: 0, busyTerminals: [] })),
		disposeAll: vi.fn(),
		getConfiguration: vi.fn(() => terminalConfiguration),
		getOrCreateTerminal: vi.fn(),
		getTerminals: vi.fn(() => []),
		getUnretrievedOutput: vi.fn(() => ""),
		isProcessHot: vi.fn(() => false),
		processOutput: vi.fn((lines: string[]) => lines.join("\n")),
		runCommand: vi.fn(),
	}
}

function createCallbacks(): CommandExecutorCallbacks {
	return {
		addToUserMessageContent: vi.fn(),
		ask: vi.fn(async () => ({ response: "messageResponse" })),
		getClineMessages: () => [],
		say: vi.fn(async () => undefined),
		updateBackgroundCommandState: vi.fn(),
		updateClineMessage: vi.fn(async () => undefined),
	}
}

describe("CommandExecutor explicit background execution", () => {
	it("applies the owning workspace shell environment without replacing the displayed command", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "dline-command-environment-"))
		const platform = process.platform
		const profile = platform === "win32" ? "powershell-legacy" : "bash"
		const configuredTerminal = { ...terminalConfiguration, defaultTerminalProfile: profile }
		const processResult = new FakeTerminalProcess()
		const terminalInfo: TerminalInfo = {
			id: 1,
			terminal: {
				dispose: vi.fn(),
				hide: vi.fn(),
				name: "Configured terminal",
				processId: Promise.resolve(1),
				sendText: vi.fn(),
				show: vi.fn(),
			},
			busy: false,
			lastActive: Date.now(),
			lastCommand: "",
		}
		try {
			await mkdir(path.join(workspace, ".agents"), { recursive: true })
			await writeFile(
				path.join(workspace, ".agents", "bashrc.yml"),
				`version: 1\nplatforms:\n  ${platform}:\n    profiles:\n      ${profile}:\n        environment:\n          DLINE_TEST_ENV: configured\n        commands:\n          - Initialize-DlineShell\n`,
				"utf8",
			)
			const terminalManager = createTerminalManager()
			vi.mocked(terminalManager.getOrCreateTerminal).mockResolvedValue(terminalInfo)
			vi.mocked(terminalManager.runCommand).mockReturnValue(processResult.asResultPromise())
			const executor = new CommandExecutor(
				{
					cwd: workspace,
					workspaceRoots: [workspace],
					taskId: "task-environment",
					terminalExecutionMode: "vscodeTerminal",
					terminalManager,
					terminalConfiguration: configuredTerminal,
					ulid: "task-environment-ulid",
				},
				createCallbacks(),
			)

			const execution = executor.execute("Run-Configured-Command", 30, { synchronous: true, workdirectory: workspace })
			await vi.waitFor(() => assert.equal(vi.mocked(terminalManager.runCommand).mock.calls.length, 1))
			processResult.complete({ exitCode: 0, signal: null })
			processResult.continue()
			await execution

			const launchConfiguration = vi.mocked(terminalManager.getOrCreateTerminal).mock.calls[0]?.[1]
			assert.equal(launchConfiguration?.environment?.DLINE_TEST_ENV, "configured")
			assert.equal(typeof launchConfiguration?.configurationId, "string")
			assert.equal(
				vi.mocked(terminalManager.runCommand).mock.calls[0]?.[1],
				platform === "win32"
					? "& { Initialize-DlineShell; if (-not $?) { exit 1 }; Run-Configured-Command }"
					: "Initialize-DlineShell && Run-Configured-Command",
			)
			assert.equal(terminalInfo.lastCommand, "Run-Configured-Command")
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("applies one configuration to both primary and background terminal managers", () => {
		const primaryManager = createTerminalManager()
		const standaloneConfigure = vi.spyOn(StandaloneTerminalManager.prototype, "configure")
		try {
			new CommandExecutor(
				{
					cwd: "C:\\workspace",
					taskId: "task-1",
					terminalExecutionMode: "vscodeTerminal",
					terminalManager: primaryManager,
					terminalConfiguration,
					ulid: "task-ulid",
				},
				createCallbacks(),
			)

			assert.deepEqual(vi.mocked(primaryManager.configure).mock.calls, [[terminalConfiguration]])
			assert.deepEqual(standaloneConfigure.mock.calls, [[terminalConfiguration]])
		} finally {
			standaloneConfigure.mockRestore()
		}
	})

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
				terminalConfiguration,
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
			origin: "explicit_background",
			cancellationOwner: "explicit",
			injectionState: "pending",
			lineCount: 0,
			logFilePath: "C:\\Temp\\command_101_1.log",
			process: processPromise,
			startTime: Date.now(),
			status: "running",
		}
		const trackBackgroundCommand = vi.spyOn(standaloneManager, "trackBackgroundCommand").mockReturnValue(backgroundCommand)

		const result = await executor.execute("serve", 30, {
			commandTs: 101,
			startInBackground: true,
			workdirectory: "C:\\workspace\\service",
		})

		assert.equal(vi.mocked(primaryManager.getOrCreateTerminal).mock.calls.length, 0)
		assert.equal(getOrCreateTerminal.mock.calls.length, 1)
		assert.equal(getOrCreateTerminal.mock.calls[0]?.[0], "C:\\workspace\\service")
		assert.equal(runCommand.mock.calls.length, 1)
		assert.equal(hide.mock.calls.length, 1)
		assert.equal(show.mock.calls.length, 0)
		assert.equal(trackBackgroundCommand.mock.calls.length, 1)
		assert.equal(trackBackgroundCommand.mock.calls[0]?.[2], "command_101_1")
		const ownership = trackBackgroundCommand.mock.calls[0]?.[4]
		assert.deepEqual(
			{ origin: ownership?.origin, cancellationOwner: ownership?.cancellationOwner },
			{
				origin: "explicit_background",
				cancellationOwner: "explicit",
			},
		)
		assert.equal(typeof ownership?.startedAt, "number")
		assert.equal(typeof ownership?.deadlineAt, "number")
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

	it("keeps explicit background work alive during Task cancellation and cancels it only explicitly", async () => {
		const process = new FakeTerminalProcess()
		const processPromise = process.asResultPromise()
		const executor = new CommandExecutor(
			{
				cwd: "C:\\workspace",
				taskId: "task-1",
				terminalExecutionMode: "vscodeTerminal",
				terminalManager: createTerminalManager(),
				terminalConfiguration,
				ulid: "task-ulid",
			},
			createCallbacks(),
		)
		const internals = executor as unknown as {
			currentProcess: TerminalProcessResultPromise | null
			processes: Map<string, TerminalProcessResultPromise>
			cancellationOwners: Map<string, "explicit" | "task">
		}
		internals.currentProcess = processPromise
		internals.processes.set("explicit-1", processPromise)
		internals.cancellationOwners.set("explicit-1", "explicit")

		assert.equal(executor.hasTaskOwnedCommand(), false)
		assert.equal(await executor.cancelTaskOwnedCommands(), false)
		assert.equal(process.terminate.mock.calls.length, 0)
		assert.equal(await executor.cancelBackgroundCommand(), true)
		assert.equal(process.terminate.mock.calls.length, 1)
	})

	it("terminates task-owned detached foreground work exactly once", async () => {
		const process = new FakeTerminalProcess()
		const processPromise = process.asResultPromise()
		const executor = new CommandExecutor(
			{
				cwd: "C:\\workspace",
				taskId: "task-1",
				terminalExecutionMode: "vscodeTerminal",
				terminalManager: createTerminalManager(),
				terminalConfiguration,
				ulid: "task-ulid",
			},
			createCallbacks(),
		)
		const standalone = (executor as unknown as { standaloneManager: StandaloneTerminalManager }).standaloneManager
		const command: BackgroundCommand = {
			id: "detached-1",
			command: "watch",
			startTime: Date.now(),
			status: "running",
			origin: "foreground",
			cancellationOwner: "task",
			logFilePath: "C:\\Temp\\detached-1.log",
			lineCount: 0,
			process: processPromise,
		}
		vi.spyOn(standalone, "getRunningBackgroundCommands").mockImplementation((owner) =>
			command.status === "running" && (!owner || owner === command.cancellationOwner) ? [command] : [],
		)
		vi.spyOn(standalone, "cancelBackgroundCommand").mockImplementation(() => {
			if (command.status !== "running") return false
			command.status = "cancelled"
			process.terminate()
			return true
		})
		const internals = executor as unknown as {
			currentProcess: TerminalProcessResultPromise | null
			processes: Map<string, TerminalProcessResultPromise>
			cancellationOwners: Map<string, "explicit" | "task">
		}
		internals.currentProcess = processPromise
		internals.processes.set(command.id, processPromise)
		internals.cancellationOwners.set(command.id, "task")

		assert.equal(executor.hasTaskOwnedCommand(), true)
		assert.equal(await executor.cancelTaskOwnedCommands(), true)
		assert.equal(command.status, "cancelled")
		assert.equal(process.terminate.mock.calls.length, 1)
		assert.equal(await executor.cancelTaskOwnedCommands(), false)
		assert.equal(process.terminate.mock.calls.length, 1)
	})

	it("cancels by canonical function identity and keeps cancellation terminal when the process reports an error", async () => {
		const process = new FakeTerminalProcess()
		const processPromise = process.asResultPromise()
		const terminalManager = createTerminalManager()
		vi.mocked(terminalManager.getOrCreateTerminal).mockResolvedValue({
			id: 1,
			terminal: {
				dispose: vi.fn(),
				hide: vi.fn(),
				name: "Foreground terminal",
				processId: Promise.resolve(1),
				sendText: vi.fn(),
				show: vi.fn(),
			},
			busy: false,
			lastActive: Date.now(),
			lastCommand: "",
		})
		vi.mocked(terminalManager.runCommand).mockReturnValue(processPromise)
		const updateCommandActivity = vi.fn()
		const updateClineMessage = vi.fn(async () => undefined)
		const executor = new CommandExecutor(
			{
				cwd: "C:\\workspace",
				taskId: "task-1",
				terminalExecutionMode: "vscodeTerminal",
				terminalManager,
				terminalConfiguration,
				ulid: "task-ulid",
			},
			{
				...createCallbacks(),
				getClineMessages: () => [{ ask: "command", text: "watch", ts: 77 }],
				updateClineMessage,
				updateCommandActivity,
			},
		)

		const execution = executor.execute("watch", undefined, { commandTs: 77, functionId: "call-watch" })
		await vi.waitFor(() => expect(executor.hasTaskOwnedCommand()).toBe(true))
		expect(await executor.cancelCommandByFunctionId("call-unknown")).toBe(false)
		expect(await executor.cancelCommandByFunctionId("call-watch")).toBe(true)
		process.emit("error", new Error("terminated"))
		process.continue()
		await execution

		expect(await executor.cancelCommandByFunctionId("call-watch")).toBe(false)
		expect(process.terminate).toHaveBeenCalledTimes(1)
		expect(updateCommandActivity).toHaveBeenCalledWith("command_77_1", expect.objectContaining({ status: "cancelled" }))
		expect(updateCommandActivity).not.toHaveBeenCalledWith("command_77_1", expect.objectContaining({ status: "failed" }))
		expect(updateClineMessage).toHaveBeenCalledWith(0, { commandStatus: "cancelled" })
		expect(updateClineMessage).not.toHaveBeenCalledWith(0, expect.objectContaining({ commandStatus: "failed" }))
	})
})
