import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { describe, it, vi } from "vitest"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	ITerminalProcess,
	OrchestrationResult,
	TerminalCompletionDetails,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "./types"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	isHot = false
	waitForShellIntegration = false
	private readonly promise: Promise<void>
	private resolvePromise!: () => void
	private rejectPromise!: (error: Error) => void

	constructor() {
		super()
		this.promise = new Promise<void>((resolve, reject) => {
			this.resolvePromise = resolve
			this.rejectPromise = reject
		})
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

describe("CommandOrchestrator exit status messaging", () => {
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
