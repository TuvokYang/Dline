import { describe, expect, it } from "vitest"
import { TaskPhase } from "../../TaskPhase"
import { reduceTask } from "../TaskReducer"
import { createTaskRuntimeState, type TaskRuntimeState } from "../TaskRuntimeState"

function profileErrorState(kind: "error_retry" | "tool_approval" = "error_retry"): TaskRuntimeState {
	return {
		...createTaskRuntimeState({
			taskId: "task-1",
			phase: TaskPhase.AWAITING_APPROVAL,
			revision: 4,
			anchor: { apiIndex: 2, uiMessageTs: 100, turnId: "retry-1", interactionId: "retry-1" },
		}),
		interaction: {
			taskId: "task-1",
			turnId: "retry-1",
			interactionId: "retry-1",
			kind,
			status: "awaiting",
			createdRevision: 4,
			anchor: { messageTs: 100, messageType: "ask" },
		},
		profileInvalid: {
			reason: "missing",
			message: 'Profile not valid: "missing" no longer exists.',
		},
	}
}

describe("Task Profile recovery runtime", () => {
	it("closes the matching Profile error interaction after a durable replacement commit", () => {
		const result = reduceTask(profileErrorState(), {
			type: "PROFILE_RECOVERY_COMMITTED",
			interactionId: "retry-1",
		})

		expect(result.accepted).toBe(true)
		expect(result.next.phase).toBe(TaskPhase.BETWEEN_TURNS)
		expect(result.next.interaction).toBeUndefined()
		expect(result.next.profileInvalid).toBeUndefined()
		expect(result.next.anchor).toEqual({ apiIndex: 2, uiMessageTs: 100 })
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("does not clear a non-error interaction", () => {
		const state = profileErrorState("tool_approval")
		const result = reduceTask(state, {
			type: "PROFILE_RECOVERY_COMMITTED",
			interactionId: "retry-1",
		})

		expect(result.accepted).toBe(false)
		expect(result.next).toBe(state)
	})
})
