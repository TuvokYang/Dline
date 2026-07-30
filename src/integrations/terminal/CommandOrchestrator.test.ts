import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { afterEach, describe, it, vi } from "vitest"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	ITerminalProcess,
	OrchestrationResult,
	TerminalCompletionDetails,
	TerminalOutputLine,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "./types"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	isHot = false
	waitForShellIntegration = false
	readonly terminate = vi.fn(async () => undefined)
	readonly started: Promise<number>
	private readonly promise: Promise<void>
	private resolvePromise!: () => void
	private rejectPromise!: (error: Error) => void
	private resolveStarted!: (startedAt: number) => void

	constructor(deferStart = false) {
		super()
		this.started = new Promise<number>((resolve) => {
			this.resolveStarted = resolve
		})
		this.promise = new Promise<void>((resolve, reject) => {
			this.resolvePromise = resolve
			this.rejectPromise = reject
		})
		if (!deferStart) this.markStarted()
	}

	markStarted(): void {
		this.resolveStarted(Date.now())
	}

	continue(): void {
		this.emit("continue")
		this.resolvePromise()
	}

	getUnretrievedOutput(): string {
		return ""
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {}
	}

	emitOutput(line: string, stream: "stdout" | "stderr" | "combined"): void {
		this.emit("line", line, stream)
	}

	complete(details?: TerminalCompletionDetails): void {
		this.emit("completed", details)
		this.emit("continue")
		this.resolvePromise()
	}

	fail(error: Error): void {
		this.emit("error", error)
		this.rejectPromise(error)
	}

	asResultPromise(): TerminalProcessResultPromise {
		const processWithPromise = this as unknown as FakeTerminalProcess & Partial<TerminalProcessResultPromise>
		processWithPromise.then = this.promise.then.bind(this.promise)
		processWithPromise.catch = this.promise.catch.bind(this.promise)
		processWithPromise.finally = this.promise.finally.bind(this.promise)
		return processWithPromise as TerminalProcessResultPromise
	}
}

function createCallbacks(messages: Array<Record<string, unknown>> = []): CommandExecutorCallbacks {
	return {
		say: async () => undefined,
		ask: async () => ({ response: "messageResponse" }),
		updateBackgroundCommandState: () => {},
		updateClineMessage: async (index, updates) => {
			Object.assign(messages[index], updates)
		},
		getClineMessages: () => messages,
		addToUserMessageContent: () => {},
	}
}

function createTerminalManager(): ITerminalManager {
	return {
		processOutput: (outputLines: string[]) => outputLines.join("\n"),
	} as ITerminalManager
}

afterEach(() => {
	vi.useRealTimers()
})

describe("CommandOrchestrator background transitions", () => {
	it("returns stable tracking metadata without retaining a foreground completion timer", async () => {
		vi.useFakeTimers()
		const process = new FakeTerminalProcess()
		const onOutputLine = vi.fn()
		const onProceedWhileRunning = vi.fn(() => ({
			backgroundCommandId: "background-1",
			logFilePath: "C:\\Temp\\background-1.log",
		}))

		const result = await orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "long-running-command",
			onOutputLine,
			onProceedWhileRunning,
			startInBackground: true,
		})

		assert.equal(result.completed, false)
		assert.equal(result.backgroundCommandId, "background-1")
		assert.equal(result.logFilePath, "C:\\Temp\\background-1.log")
		assert.equal(onProceedWhileRunning.mock.calls.length, 1)
		assert.equal(vi.getTimerCount(), 0)

		process.emit("line", "background output", "combined")
		await Promise.resolve()
		await Promise.resolve()
		assert.equal(onOutputLine.mock.calls.length, 0)
	})

	it("includes output emitted immediately before the automatic handoff", async () => {
		vi.useFakeTimers()
		const process = new FakeTerminalProcess()
		const onProceedWhileRunning = vi.fn((_existingOutput: TerminalOutputLine[]) => ({
			backgroundCommandId: "background-tail",
			logFilePath: "C:\\Temp\\background-tail.log",
		}))
		const execution = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "slow-output-command",
			onProceedWhileRunning,
			timeoutSeconds: 60,
		})

		process.emit("line", "first", "combined")
		await vi.advanceTimersByTimeAsync(9_999)
		process.emit("line", "tail", "combined")
		await vi.advanceTimersByTimeAsync(1)
		if (onProceedWhileRunning.mock.calls.length === 0) {
			process.complete({ exitCode: 0, signal: null })
		}
		await execution

		assert.equal(onProceedWhileRunning.mock.calls.length, 1)
		assert.deepEqual(onProceedWhileRunning.mock.calls[0]?.[0], [
			{ line: "first", stream: "combined" },
			{ line: "tail", stream: "combined" },
		])
	})

	it("hands a still-running command to the background tracker after 10 seconds without reporting a timeout", async () => {
		vi.useFakeTimers()
		const process = new FakeTerminalProcess()
		const onOutputLine = vi.fn()
		const onProceedWhileRunning = vi.fn(() => ({
			backgroundCommandId: "background-timeout",
			logFilePath: "C:\\Temp\\background-timeout.log",
		}))
		const execution = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "slow-command",
			onOutputLine,
			onProceedWhileRunning,
			timeoutSeconds: 60,
		})

		await vi.advanceTimersByTimeAsync(10_000)
		const handedOffAtTenSeconds = onProceedWhileRunning.mock.calls.length
		if (handedOffAtTenSeconds === 0) {
			process.complete({ exitCode: 0, signal: null })
		}
		const result = await execution

		assert.equal(result.completed, false)
		assert.equal(result.backgroundCommandId, "background-timeout")
		assert.equal(result.logFilePath, "C:\\Temp\\background-timeout.log")
		assert.match(result.result as string, /still running after 10 seconds/i)
		assert.doesNotMatch(result.result as string, /timed out/i)
		assert.equal(handedOffAtTenSeconds, 1)
		assert.equal(vi.getTimerCount(), 0)

		process.emit("line", "background output", "combined")
		await Promise.resolve()
		await Promise.resolve()
		assert.equal(onOutputLine.mock.calls.length, 0)
	})

	it("kills a synchronous command at its absolute timeout without handing it to the background tracker", async () => {
		vi.useFakeTimers()
		const process = new FakeTerminalProcess()
		const onProceedWhileRunning = vi.fn(() => ({ backgroundCommandId: "unexpected-background" }))
		const onTimeout = vi.fn()
		const execution = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "blocking-command",
			onProceedWhileRunning,
			onTimeout,
			synchronous: true,
			timeoutSeconds: 60,
		})

		await vi.advanceTimersByTimeAsync(10_000)
		assert.equal(onProceedWhileRunning.mock.calls.length, 0)
		assert.equal(process.terminate.mock.calls.length, 0)

		await vi.advanceTimersByTimeAsync(50_000)
		const result = await execution

		assert.equal(onProceedWhileRunning.mock.calls.length, 0)
		assert.equal(onTimeout.mock.calls.length, 1)
		assert.equal(process.terminate.mock.calls.length, 1)
		assert.equal(result.timedOut, true)
		assert.match(result.result as string, /60-second timeout/i)
	})

	it("starts the absolute timeout only after the process launch signal", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(0)
		const process = new FakeTerminalProcess(true)
		const execution = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "delayed-launch-command",
			synchronous: true,
			timeoutSeconds: 60,
		})

		await vi.advanceTimersByTimeAsync(60_000)
		assert.equal(process.terminate.mock.calls.length, 0)

		process.markStarted()
		await vi.advanceTimersByTimeAsync(59_999)
		assert.equal(process.terminate.mock.calls.length, 0)

		await vi.advanceTimersByTimeAsync(1)
		const result = await execution
		assert.equal(process.terminate.mock.calls.length, 1)
		assert.equal(result.timedOut, true)
	})

	it("kills a default command when its timeout is shorter than the 10-second handoff", async () => {
		vi.useFakeTimers()
		const process = new FakeTerminalProcess()
		const onProceedWhileRunning = vi.fn(() => ({ backgroundCommandId: "unexpected-background" }))
		const execution = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), createCallbacks(), {
			command: "short-deadline-command",
			onProceedWhileRunning,
			timeoutSeconds: 5,
		})

		await vi.advanceTimersByTimeAsync(5_000)
		const result = await execution

		assert.equal(onProceedWhileRunning.mock.calls.length, 0)
		assert.equal(process.terminate.mock.calls.length, 1)
		assert.equal(result.timedOut, true)
	})
})

describe("CommandOrchestrator exit status messaging", () => {
	it("collects stdout and stderr separately in the final tool result", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "mixed-output" },
		)

		process.emitOutput("normal output", "stdout")
		process.emitOutput("error output", "stderr")
		process.complete({ exitCode: 1, signal: null })
		const result = await orchestrationPromise

		assert.deepEqual(result.stdoutLines, ["normal output"])
		assert.deepEqual(result.stderrLines, ["error output"])
		assert.deepEqual(result.outputLines, ["normal output", "error output"])
		assert.match(result.result as string, /\[O\] normal output\n\[E\] error output/)
		assert.doesNotMatch(result.result as string, /\nOutput:\n/)
	})

	it("reports non-zero exit codes as command failures", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "false" },
		)

		process.complete({ exitCode: 2, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 2)
		assert.match(result.result as string, /^Command failed with exit code 2\./)
	})

	it("marks an approved command with a non-zero exit code as failed", async () => {
		const process = new FakeTerminalProcess()
		const messages: Array<Record<string, unknown>> = [{ ask: "command", ts: 100, commandStatus: "pending" }]
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(messages),
			{ command: "false", commandTs: 100 },
		)
		await vi.waitFor(() => {
			assert.equal(messages[0]?.commandStatus, "running")
		})

		process.complete({ exitCode: 2, signal: null })
		await orchestrationPromise
		await vi.waitFor(() => {
			assert.notEqual(messages[0]?.commandStatus, "running")
		})

		assert.equal(messages[0]?.commandStatus, "failed")
		assert.equal(messages[0]?.exitCode, 2)
	})

	it("does not report success when completion has no exit code", async () => {
		const process = new FakeTerminalProcess()
		const messages: Array<Record<string, unknown>> = [{ ask: "command", ts: 200, commandStatus: "pending" }]
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(messages),
			{ command: "unknown", commandTs: 200 },
		)
		await vi.waitFor(() => {
			assert.equal(messages[0]?.commandStatus, "running")
		})

		process.complete({ exitCode: undefined, signal: null })
		const result = await orchestrationPromise
		await vi.waitFor(() => {
			assert.equal(messages[0]?.commandStatus, "failed")
		})

		assert.match(result.result as string, /could not be verified/)
	})

	it("reports termination signals even when an exit code is present", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "interrupted" },
		)

		process.complete({ exitCode: 0, signal: "SIGINT" })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.signal, "SIGINT")
		assert.match(result.result as string, /^Command terminated by signal SIGINT\./)
	})

	it("reports successful command completion with explicit exit code", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "echo ok" },
		)

		process.complete({ exitCode: 0, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 0)
		assert.match(result.result as string, /^Command executed successfully \(exit code 0\)\./)
	})
})
