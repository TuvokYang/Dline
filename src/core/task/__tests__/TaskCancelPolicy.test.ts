import { describe, expect, it } from "vitest"
import { createTaskRuntimeState } from "../runtime/TaskRuntimeState"
import { shouldRunTaskCancelHook, type TaskCancelActivity } from "../TaskCancelPolicy"
import { TaskPhase } from "../TaskPhase"

const IDLE_ACTIVITY: TaskCancelActivity = {
	hasActiveHook: false,
	isStreaming: false,
	isWaitingForFirstChunk: false,
	hasActiveBackgroundCommand: false,
}

/** Create one runtime aggregate with an optional active interaction. */
function runtime(phase: TaskPhase, interactionKind?: "resume" | "completion") {
	return {
		...createTaskRuntimeState({ taskId: "task-1", phase, revision: 4 }),
		...(interactionKind
			? {
					interaction: {
						taskId: "task-1",
						turnId: "turn-1",
						interactionId: `${interactionKind}-1`,
						kind: interactionKind,
						status: "awaiting" as const,
						createdRevision: 4,
					},
				}
			: {}),
	}
}

describe("TaskCancelPolicy", () => {
	it("does not run while a paused resume interaction awaits the user", () => {
		expect(
			shouldRunTaskCancelHook({ runtime: runtime(TaskPhase.PAUSED, "resume"), source: "user", activity: IDLE_ACTIVITY }),
		).toBe(false)
	})

	it("does not run while completion feedback awaits the user", () => {
		expect(
			shouldRunTaskCancelHook({
				runtime: runtime(TaskPhase.COMPLETED, "completion"),
				source: "user",
				activity: IDLE_ACTIVITY,
			}),
		).toBe(false)
	})

	it("runs for an active runtime phase", () => {
		expect(shouldRunTaskCancelHook({ runtime: runtime(TaskPhase.EXECUTING), source: "user", activity: IDLE_ACTIVITY })).toBe(
			true,
		)
	})

	it("runs when external runtime activity is active", () => {
		expect(
			shouldRunTaskCancelHook({
				runtime: runtime(TaskPhase.PAUSED, "resume"),
				source: "user",
				activity: { ...IDLE_ACTIVITY, hasActiveBackgroundCommand: true },
			}),
		).toBe(true)
	})

	it("does not recursively run for hook-origin cancellation", () => {
		expect(
			shouldRunTaskCancelHook({
				runtime: runtime(TaskPhase.STREAMING),
				source: "hook",
				activity: { ...IDLE_ACTIVITY, isStreaming: true },
			}),
		).toBe(false)
	})
})
