import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractMethod(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker)
	const end = source.indexOf(endMarker, start)
	if (start < 0 || end < 0) {
		throw new Error(`Unable to locate Task cancellation boundary: ${startMarker}`)
	}
	return source.slice(start, end)
}

describe("Task cancellation responsiveness", () => {
	// Cancel is the high-frequency user action. Its clean-up must bound the
	// worst case to a single timeout, the way terminate() already does, instead
	// of summing unbounded sequential awaits.
	it("cancels hook, task-owned commands and task activities concurrently", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async abortExecution()", "\tasync interrupt(")

		const settledIndex = method.indexOf("Promise.allSettled(")
		expect(settledIndex).toBeGreaterThanOrEqual(0)

		// Every clean-up branch must sit inside the concurrent batch.
		const hookIndex = method.indexOf("this.cancelHookExecution()")
		const commandIndex = method.indexOf("this.commandExecutor.cancelTaskOwnedCommands()")
		const activityIndex = method.indexOf("this.activityStore.cancel(")
		expect(hookIndex).toBeGreaterThan(settledIndex)
		expect(commandIndex).toBeGreaterThan(settledIndex)
		expect(activityIndex).toBeGreaterThan(settledIndex)
	})

	// An unresponsive hook, command or activity must not stall the whole
	// cancellation. Each branch carries its own deadline.
	it("bounds every clean-up branch with its own timeout", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async abortExecution()", "\tasync interrupt(")

		// Match irrespective of formatter line breaks between the guard and its
		// wrapped call.
		for (const guarded of [
			"this.cancelHookExecution()",
			"this.commandExecutor.cancelTaskOwnedCommands()",
			"this.activityStore.cancel(",
		]) {
			const callIndex = method.indexOf(guarded)
			expect(callIndex).toBeGreaterThanOrEqual(0)
			const guardIndex = method.lastIndexOf("withTerminateTimeout(", callIndex)
			expect(guardIndex).toBeGreaterThanOrEqual(0)
			// Nothing but whitespace may separate the guard from the call it wraps.
			expect(method.slice(guardIndex + "withTerminateTimeout(".length, callIndex).trim()).toBe("")
		}
	})

	// The TaskCancel hook can invoke a model. Without a deadline it alone can
	// keep the user waiting for the entire request.
	it("bounds the TaskCancel hook", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async abortExecution()", "\tasync interrupt(")

		const hookCallIndex = method.indexOf('hookName: "TaskCancel"')
		expect(hookCallIndex).toBeGreaterThanOrEqual(0)
		const guardIndex = method.lastIndexOf("withTerminateTimeout(", hookCallIndex)
		expect(guardIndex).toBeGreaterThanOrEqual(0)
	})

	// interrupt() and terminate() already guard this wait. The user-facing
	// cancel path must not be the only one that can hang forever on a provider
	// stream or tool that ignores the abort signal.
	it("bounds the superseded-operation wait in requestCancellation", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "public async requestCancellation()", "\t/** Commit a checkpoint chat rewind")

		expect(method).toContain("this.taskRuntime.waitForDeferredEffectsThrough(cutoffRevision)")
		expect(method).toContain("this.interactionCoordinator.waitForClaimedContinuations()")
		expect(method).toContain("withTerminateTimeout(")
	})

	// Cancel pauses the task; it must not reach into work the user explicitly
	// moved to the background. Only terminate() performs the unfiltered sweep.
	it("restricts clean-up to task-owned work and leaves explicit background work running", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async abortExecution()", "\tasync interrupt(")

		expect(method).toContain('this.activityStore.listRunning("task")')
		expect(method).toContain("this.commandExecutor.cancelTaskOwnedCommands()")

		// These unfiltered sweeps belong to terminate() only.
		expect(method).not.toContain("this.activityStore.listRunning()")
		expect(method).not.toContain("this.commandExecutor.cancelBackgroundCommand()")
	})
})
