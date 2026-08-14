import { describe, expect, it } from "vitest"
import type { TaskEffect } from "../../runtime/TaskEffect"
import type { TaskEvent } from "../../runtime/TaskEvent"
import { reduceTask } from "../../runtime/TaskReducer"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"

interface NewTaskHandoffFixture {
	context: string
	source: { functionId: string; dlineTid: string }
	initialUserContent: Array<{ type: "text"; text: string }>
	taskSettings: {
		mode: "plan" | "act"
		planModeProfile?: string
		actModeProfile?: string
	}
}

/** Reduce a successor admission from a completed assistant turn. */
function reduceSuccessor(handoff: NewTaskHandoffFixture) {
	const state = createTaskRuntimeState({
		taskId: "task-old",
		phase: TaskPhase.BETWEEN_TURNS,
		revision: 8,
		anchor: { apiIndex: 3, turnId: "turn-new-task" },
	})
	return reduceTask(state, { type: "TASK_SUCCESSOR_REQUESTED", handoff } as TaskEvent)
}

/** Return effect types while retaining typed payload assertions below. */
function effectTypes(effects: readonly TaskEffect[]): string[] {
	return effects.map((effect) => effect.type)
}

describe("New Task runtime handoff", () => {
	it("admits an independent successor while retaining only consumed identity on the old Task", () => {
		const handoff: NewTaskHandoffFixture = {
			context: "Continue with the isolated migration task",
			source: { functionId: "function-new-task", dlineTid: "tid-new-task" },
			initialUserContent: [{ type: "text", text: "<feedback>\nKeep the migration boundary\n</feedback>" }],
			taskSettings: {
				mode: "act",
				planModeProfile: "plan-profile-old",
				actModeProfile: "act-profile-old",
			},
		}

		const result = reduceSuccessor(handoff)

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.CANCELLING,
				cancellation: { source: "system", fromPhase: TaskPhase.BETWEEN_TURNS },
				newTaskConsumed: handoff.source,
				supersededEffectRevision: 8,
			},
		})
		expect(result.next).not.toHaveProperty("pendingReplacement")
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT", "START_SUCCESSOR_TASK"])
		expect(result.effects[2]).toEqual(
			expect.objectContaining({
				type: "START_SUCCESSOR_TASK",
				handoff,
			}),
		)
	})

	it("commits the consumed old Task to an inert aborted state before Controller handoff", () => {
		const admitted = reduceSuccessor({
			context: "Next task",
			source: { functionId: "function-new-task", dlineTid: "tid-new-task" },
			initialUserContent: [],
			taskSettings: { mode: "plan" },
		})

		const committed = reduceTask(admitted.next, {
			type: "TASK_SUCCESSOR_START_COMMITTED",
			source: { functionId: "function-new-task", dlineTid: "tid-new-task" },
		})

		expect(committed).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.ABORTED,
				newTaskConsumed: { functionId: "function-new-task", dlineTid: "tid-new-task" },
			},
		})
		expect(committed.next.cancellation).toBeUndefined()
	})

	it("keeps generic completion Start New Task on the clear-to-Welcome effect", () => {
		const state = {
			...createTaskRuntimeState({ taskId: "task-old", phase: TaskPhase.COMPLETED, revision: 4 }),
			completion: { completionId: "completion-1" },
			interaction: {
				taskId: "task-old",
				turnId: "turn-completion",
				interactionId: "completion-1",
				kind: "completion" as const,
				status: "resolving" as const,
				createdRevision: 3,
				anchor: { messageTs: 100, messageType: "ask" as const },
				acceptedResponse: {
					taskId: "task-old",
					turnId: "turn-completion",
					interactionId: "completion-1",
					actionId: "start_new_task" as const,
					stateRevision: 4,
					draft: { text: "", images: [], files: [] },
				},
			},
		}

		const result = reduceTask(state, {
			type: "TASK_CLEAR_REQUESTED",
			draft: { text: "", images: [], files: [] },
		})

		expect(result.accepted).toBe(true)
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT", "START_NEW_TASK"])
		expect(result.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "START_SUCCESSOR_TASK" })]))
	})
})
