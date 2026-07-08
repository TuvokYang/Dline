import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import { Controller } from "../index"

/**
 * Flush pending microtasks so async continuations can run in fake-timer tests.
 *
 * @param iterations Number of microtask turns to await.
 * @returns Promise resolved after pending microtasks are processed.
 */
async function flushMicrotasks(iterations = 5): Promise<void> {
	for (let i = 0; i < iterations; i++) {
		await Promise.resolve()
	}
}

/**
 * Build a minimal Controller-like object for cancelTask behavior tests.
 *
 * @returns Fake controller and spies used by the test.
 */
function createCancelController(): {
	controller: Pick<Controller, "cancelTask">
	task: {
		taskState: {
			isStreaming: boolean
			isWaitingForFirstChunk: boolean
			isExecutingSubagent: boolean
			isInitialized: boolean
			abort: boolean
			didFinishAbortingStream: boolean
		}
	}
	taskAsk: ReturnType<typeof vi.fn>
	postStateToWebview: ReturnType<typeof vi.fn>
} {
	const taskAsk = vi.fn(() => Promise.resolve({ response: "noButtonClicked" }))
	const postStateToWebview = vi.fn(async () => undefined)
	const task = {
		taskId: "task-1",
		taskState: {
			isStreaming: true,
			isWaitingForFirstChunk: false,
			isExecutingSubagent: false,
			isInitialized: true,
			abort: false,
			didFinishAbortingStream: false,
		},
		messageStateHandler: {
			uiMessage: { clearPartialFlags: vi.fn() },
			clineMessages: [],
		},
		abortExecution: vi.fn(async () => undefined),
		ask: taskAsk,
		resumeTask: vi.fn(async () => undefined),
	}
	const controller = {
		task,
		cancelInProgress: false,
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		updateBackgroundCommandState: vi.fn(),
		postStateToWebview,
		cancelTask: Controller.prototype.cancelTask,
	}

	return { controller: controller as unknown as Pick<Controller, "cancelTask">, task, taskAsk, postStateToWebview }
}

describe("Controller.cancelTask", () => {
	it("shows resume prompt only after stream abort cleanup is ready", async () => {
		const clock = vi.useFakeTimers()
		const { controller, task, taskAsk } = createCancelController()

		try {
			const cancelPromise = controller.cancelTask()
			await flushMicrotasks()

			assert.equal(taskAsk.mock.calls.length, 0)

			task.taskState.didFinishAbortingStream = true
			await clock.advanceTimersByTimeAsync(100)
			await flushMicrotasks()
			await cancelPromise

			assert.equal(taskAsk.mock.calls.length, 1)
			assert.equal(taskAsk.mock.calls[0][0], "resume_task")
		} finally {
			clock.useRealTimers()
		}
	})
})
