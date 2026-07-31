import { Task } from "@core/task"
import { TaskPhase } from "@core/task/TaskPhase"
import { describe, expect, it, vi } from "vitest"

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe("Task termination persistence", () => {
	it("waits for API and UI message stores to flush before returning", async () => {
		const apiFlush = deferred()
		const uiFlush = deferred()
		const flushApiConversationHistory = vi.fn(() => apiFlush.promise)
		const flushUiMessages = vi.fn(() => uiFlush.promise)
		const updateTaskHistory = vi.fn(async () => {})
		const fakeTask = {
			modeSwitchCompaction: { abort: vi.fn() },
			shouldRunTaskCancelHook: vi.fn(async () => false),
			taskRuntime: { getState: () => ({ phase: TaskPhase.CANCELLING }) },
			taskState: { abort: false, abandoned: false },
			getActiveHookExecution: vi.fn(async () => undefined),
			commandExecutor: { cancelTaskOwnedCommands: vi.fn(async () => {}) },
			stateManager: { getGlobalSettingsKey: vi.fn(() => false) },
			flushTaskSnapshot: vi.fn(async () => {}),
			messageStateHandler: { flushApiConversationHistory, flushUiMessages, updateTaskHistory },
			postStateToWebview: vi.fn(async () => {}),
			getCurrentProviderInfo: () => ({
				providerId: "openai",
				mode: "act",
				model: { id: "test-model", info: { capabilities: { contextWindow: 128_000 } } },
			}),
			FocusChainManager: undefined,
			terminalManager: { disposeAll: vi.fn() },
			urlContentFetcher: { closeBrowser: vi.fn() },
			clineIgnoreController: { dispose: vi.fn() },
			taskFileTracker: { dispose: vi.fn() },
			fileContextTracker: { dispose: vi.fn() },
			mcpHub: { removeNotificationCallback: vi.fn() },
			_mcpNotificationCb: undefined,
			activityStore: { dispose: vi.fn(), waitForPersistence: vi.fn(async () => {}) },
			browserSession: { dispose: vi.fn(async () => {}) },
			diffViewProvider: { revertChanges: vi.fn(async () => {}) },
			presentationScheduler: { dispose: vi.fn(async () => {}) },
		} as unknown as Task

		let completed = false
		const termination = Task.prototype.terminate.call(fakeTask).then(() => {
			completed = true
		})

		await vi.waitFor(() => {
			expect(flushApiConversationHistory).toHaveBeenCalled()
			expect(flushUiMessages).toHaveBeenCalled()
		})
		await Promise.resolve()
		expect(completed).toBe(false)

		apiFlush.resolve()
		uiFlush.resolve()
		await termination
		expect(updateTaskHistory).toHaveBeenCalled()
	})

	it("does not restore a retained approval machine while terminating an executing turn", async () => {
		const dispatchRuntime = vi.fn(async () => ({ accepted: true }))
		const cancelTaskOwnedCommands = vi.fn(async () => true)
		const flushTaskSnapshot = vi.fn(async () => {})
		const flushApiConversationHistory = vi.fn(async () => {})
		const flushUiMessages = vi.fn(async () => {})
		const fakeTask = {
			modeSwitchCompaction: { abort: vi.fn() },
			shouldRunTaskCancelHook: vi.fn(async () => false),
			taskRuntime: { getState: () => ({ phase: TaskPhase.EXECUTING }) },
			dispatchRuntime,
			syncRetainedMachines: vi.fn(() => {
				throw new Error("Canonical activeDlineTid has no awaiting approval block")
			}),
			taskState: { abort: false, abandoned: false },
			getActiveHookExecution: vi.fn(async () => undefined),
			commandExecutor: { cancelTaskOwnedCommands },
			stateManager: { getGlobalSettingsKey: vi.fn(() => false) },
			flushTaskSnapshot,
			messageStateHandler: {
				flushApiConversationHistory,
				flushUiMessages,
				updateTaskHistory: vi.fn(async () => {}),
			},
			postStateToWebview: vi.fn(async () => {}),
			getCurrentProviderInfo: () => ({
				providerId: "openai",
				mode: "act",
				model: { id: "test-model", info: { capabilities: { contextWindow: 128_000 } } },
			}),
			FocusChainManager: undefined,
			terminalManager: { disposeAll: vi.fn() },
			urlContentFetcher: { closeBrowser: vi.fn() },
			clineIgnoreController: { dispose: vi.fn() },
			taskFileTracker: { dispose: vi.fn() },
			fileContextTracker: { dispose: vi.fn() },
			mcpHub: { removeNotificationCallback: vi.fn() },
			_mcpNotificationCb: undefined,
			activityStore: { dispose: vi.fn(), waitForPersistence: vi.fn(async () => {}) },
			browserSession: { dispose: vi.fn(async () => {}) },
			diffViewProvider: { revertChanges: vi.fn(async () => {}) },
			presentationScheduler: { dispose: vi.fn(async () => {}) },
		} as unknown as Task

		await expect(Task.prototype.terminate.call(fakeTask)).resolves.toBeUndefined()

		expect(dispatchRuntime).toHaveBeenCalledWith({ type: "TASK_TERMINATE_REQUESTED" })
		expect(cancelTaskOwnedCommands).toHaveBeenCalledOnce()
		expect(flushTaskSnapshot).toHaveBeenCalled()
		expect(flushApiConversationHistory).toHaveBeenCalled()
		expect(flushUiMessages).toHaveBeenCalled()
	})
})
