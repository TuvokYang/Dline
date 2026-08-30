import { Task } from "@core/task"
import { InteractionCancellationError } from "@core/task/interaction/InteractionCancellationError"
import { describe, expect, it, vi } from "vitest"

/**
 * A failure raised between two provider requests used to unwind the task loop
 * silently: no error row, no recovery interaction and no published view state,
 * which left the task parked in a working phase with no cancel affordance.
 */
type LoopFailureTask = {
	taskId: string
	taskState: { abort: boolean; consecutiveMistakeCount: number }
	messageStateHandler: { apiConversationHistory: unknown[] }
	say: ReturnType<typeof vi.fn>
	getRuntimeState: ReturnType<typeof vi.fn>
	recoverApiFailure: ReturnType<typeof vi.fn>
	postStateToWebview: ReturnType<typeof vi.fn>
	recursivelyMakeClineRequests: ReturnType<typeof vi.fn>
	recoverTaskLoopFailure: (error: unknown) => Promise<void>
}

/** Borrow the real recovery boundary so the loop under test uses production behavior. */
const recoverTaskLoopFailure = Reflect.get(Task.prototype, "recoverTaskLoopFailure") as (
	this: LoopFailureTask,
	error: unknown,
) => Promise<void>

function createTask(overrides: Partial<LoopFailureTask> = {}): LoopFailureTask {
	const task: LoopFailureTask = {
		taskId: "task-1",
		taskState: { abort: false, consecutiveMistakeCount: 0 },
		messageStateHandler: { apiConversationHistory: [{}, {}, {}] },
		say: vi.fn(async () => undefined),
		getRuntimeState: vi.fn(() => ({ revision: 11 })),
		recoverApiFailure: vi.fn(async () => ({ actionId: "retry" as const })),
		postStateToWebview: vi.fn(async () => undefined),
		recursivelyMakeClineRequests: vi.fn(async () => true),
		recoverTaskLoopFailure: () => Promise.resolve(),
		...overrides,
	}
	task.recoverTaskLoopFailure = (error: unknown) => recoverTaskLoopFailure.call(task, error)
	return task
}

function initiateTaskLoop(task: LoopFailureTask): Promise<void> {
	const loop = Reflect.get(Task.prototype, "initiateTaskLoop") as (
		this: LoopFailureTask,
		userContent: Array<{ type: "text"; text: string }>,
	) => Promise<void>
	return loop.call(task, [{ type: "text", text: "run the task" }])
}

describe("Task loop failure boundary", () => {
	it("surfaces a failure raised between requests as an error row, a recovery interaction and a published state", async () => {
		const task = createTask({
			recursivelyMakeClineRequests: vi.fn(async () => {
				throw new Error("Failed to acquire lock after 10 attempts")
			}),
		})

		await expect(initiateTaskLoop(task)).resolves.toBeUndefined()

		expect(task.say).toHaveBeenCalledWith("error", "Failed to acquire lock after 10 attempts")
		expect(task.recoverApiFailure).toHaveBeenCalledWith({
			turnId: "task-loop-failure:task-1:11",
			interactionId: "task-loop-failure:task-1:11",
			apiIndex: 2,
			presentation: "Failed to acquire lock after 10 attempts",
			persistedRequest: true,
		})
		expect(task.postStateToWebview).toHaveBeenCalledWith({ immediate: true })
	})

	it("still publishes state when presenting the recovery interaction fails", async () => {
		const task = createTask({
			recursivelyMakeClineRequests: vi.fn(async () => {
				throw new Error("loadContext failed")
			}),
			recoverApiFailure: vi.fn(async () => {
				throw new Error("recovery rejected")
			}),
		})

		await expect(initiateTaskLoop(task)).resolves.toBeUndefined()

		expect(task.say).toHaveBeenCalledWith("error", "loadContext failed")
		expect(task.postStateToWebview).toHaveBeenCalledWith({ immediate: true })
	})

	it("leaves an expected cancellation silent so cancel keeps owning the transition", async () => {
		const task = createTask({
			recursivelyMakeClineRequests: vi.fn(async () => {
				throw new InteractionCancellationError("task_cancelled")
			}),
		})

		await expect(initiateTaskLoop(task)).resolves.toBeUndefined()

		expect(task.say).not.toHaveBeenCalled()
		expect(task.recoverApiFailure).not.toHaveBeenCalled()
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})

	it("keeps the succeeding path free of recovery side effects", async () => {
		const task = createTask()

		await expect(initiateTaskLoop(task)).resolves.toBeUndefined()

		expect(task.recursivelyMakeClineRequests).toHaveBeenCalledTimes(1)
		expect(task.say).not.toHaveBeenCalled()
		expect(task.recoverApiFailure).not.toHaveBeenCalled()
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})
})
