import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { TaskPhase } from "../../TaskPhase"
import { reduceTask } from "../TaskReducer"
import { createTaskRuntimeState } from "../TaskRuntimeState"

/** Create a runtime state restored to a focused test phase. */
function stateAt(phase: TaskPhase) {
	return createTaskRuntimeState({ taskId: "task-1", phase })
}

/** Create runtime state awaiting one causal tool approval response. */
function awaitingInteraction() {
	return {
		...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.AWAITING_APPROVAL, revision: 4 }),
		interaction: {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "tool_approval" as const,
			status: "awaiting" as const,
			createdRevision: 4,
			anchor: { messageTs: 100, messageType: "ask" as const },
		},
	}
}

describe("reduceTask lifecycle events", () => {
	it("initializes an idle task", () => {
		const result = reduceTask(stateAt(TaskPhase.IDLE), { type: "TASK_INITIALIZE_REQUESTED" })

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.INITIALIZING, revision: 1 } })
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("moves initialization to waiting when no task is supplied", () => {
		const result = reduceTask(stateAt(TaskPhase.INITIALIZING), {
			type: "TASK_INITIALIZED",
			anchor: { apiIndex: -1 },
			hasTask: false,
		})

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.WAITING_FOR_TASK } })
		expect(result.next.anchor).toEqual({ apiIndex: -1 })
	})

	it("starts API streaming from initialization", () => {
		const result = reduceTask(stateAt(TaskPhase.INITIALIZING), { type: "API_REQUEST_STARTED", apiIndex: 3 })

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.STREAMING } })
		expect(result.next.anchor.apiIndex).toBe(3)
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("starts exactly one reconciled API continuation through an ordered effect", () => {
		const result = reduceTask(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, anchor: { apiIndex: 3 } }),
			{
				type: "RESUME_API_CONTINUATION_REQUESTED",
				apiIndex: 3,
				draft: { text: "Continue", images: ["image"], files: ["file"] },
			},
		)

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.STREAMING } })
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "START_API", "PERSIST_SNAPSHOT"])
		expect(result.effects[1]).toMatchObject({
			type: "START_API",
			apiIndex: 3,
			draft: { text: "Continue", images: ["image"], files: ["file"] },
		})
	})

	it("normalizes only reconciled pending blocks before replay", () => {
		const result = reduceTask(
			{
				...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.AWAITING_APPROVAL, revision: 4 }),
				turn: {
					turnId: "turn-1",
					assistantApiIndex: 2,
					mode: "serial",
					activeDlineTid: "tid-1",
					blocks: [
						{
							dlineTid: "tid-1",
							callId: "call-1",
							toolName: "write_to_file",
							phase: BlockPhase.AWAITING_APPROVAL,
							ts: 90,
							requiresApproval: true,
							conversationHistoryIndex: 2,
						},
						{
							dlineTid: "tid-2",
							callId: "call-2",
							toolName: "read_file",
							phase: BlockPhase.COMPLETED,
							ts: 91,
							requiresApproval: false,
							conversationHistoryIndex: 2,
						},
					],
				},
			},
			{ type: "RESUME_BLOCK_REPLAY_REQUESTED", turnId: "turn-1", dlineTids: ["tid-1"] },
		)

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.STREAMING,
				turn: { activeDlineTid: undefined, blocks: [{ phase: "streaming" }, { phase: "completed" }] },
			},
		})
	})

	it("opens an approval checkpoint from streaming", () => {
		const result = reduceTask(stateAt(TaskPhase.STREAMING), {
			type: "APPROVAL_REQUIRED",
			turnId: "turn-1",
			interactionId: "interaction-1",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.AWAITING_APPROVAL,
				anchor: { turnId: "turn-1", interactionId: "interaction-1" },
			},
		})
	})

	it("opens and presents one canonical interaction without message inference", () => {
		const opened = reduceTask(stateAt(TaskPhase.STREAMING), {
			type: "INTERACTION_OPEN_REQUESTED",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			presentation: JSON.stringify({ response: "Answer" }),
			existingTs: 100,
		})

		expect(opened).toMatchObject({
			accepted: true,
			next: {
				revision: 1,
				interaction: {
					taskId: "task-1",
					turnId: "turn-1",
					interactionId: "interaction-1",
					kind: "qna_response",
					status: "opening",
					createdRevision: 1,
				},
			},
		})
		expect(opened.effects).toEqual([
			expect.objectContaining({
				type: "APPEND_ASK",
				interactionId: "interaction-1",
				taskAsk: "qna_respond",
				presentation: JSON.stringify({ response: "Answer" }),
				existingTs: 100,
			}),
		])

		const presented = reduceTask(opened.next, {
			type: "INTERACTION_PRESENTED",
			interactionId: "interaction-1",
			messageTs: 100,
		})
		expect(presented).toMatchObject({
			accepted: true,
			next: {
				revision: 2,
				anchor: { uiMessageTs: 100, turnId: "turn-1", interactionId: "interaction-1" },
				interaction: { status: "awaiting", anchor: { messageTs: 100, messageType: "ask" } },
			},
		})
		expect(presented.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("resolves only the matching active interaction", () => {
		const awaiting = awaitingInteraction()
		const state = { ...awaiting, interaction: { ...awaiting.interaction, status: "resolving" as const } }
		const result = reduceTask(state, {
			type: "INTERACTION_RESOLVED",
			interactionId: "interaction-1",
		})

		expect(result).toMatchObject({ accepted: true, next: { revision: 5 } })
		expect(result.next.interaction).toBeUndefined()
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("commits a causal interaction response without changing task phase", () => {
		const result = reduceTask(awaitingInteraction(), {
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 4,
				draft: { text: "", images: [], files: [] },
			},
		})

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.AWAITING_APPROVAL, revision: 5, interaction: { status: "resolving" } },
		})
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("rejects stale interaction revision without mutation", () => {
		const state = awaitingInteraction()
		const result = reduceTask(state, {
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 3,
				draft: { text: "", images: [], files: [] },
			},
		})

		expect(result).toMatchObject({ accepted: false, error: { code: "stale_interaction" } })
		expect(result.next).toBe(state)
	})

	it("rejects interaction payload mismatch without mutation", () => {
		const state = awaitingInteraction()
		const result = reduceTask(state, {
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 4,
			},
		})

		expect(result).toMatchObject({ accepted: false, error: { code: "invalid_interaction_payload" } })
		expect(result.next).toBe(state)
	})

	it("turns TASK_CANCEL_REQUESTED into cancelling state and ordered effects", () => {
		const result = reduceTask(stateAt(TaskPhase.STREAMING), {
			type: "TASK_CANCEL_REQUESTED",
			source: "user",
		})

		expect(result.next).toMatchObject({
			phase: TaskPhase.CANCELLING,
			cancellation: { source: "user", fromPhase: TaskPhase.STREAMING },
		})
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "CANCEL_RUNTIME", "PERSIST_SNAPSHOT"])
	})

	it("completes cancellation into paused state", () => {
		const result = reduceTask(stateAt(TaskPhase.CANCELLING), { type: "TASK_CANCELLED" })

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.PAUSED } })
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("starts resume only from a causal resolving resume interaction", () => {
		const result = reduceTask(
			{
				...stateAt(TaskPhase.PAUSED),
				anchor: { apiIndex: 1, turnId: "resume-turn", interactionId: "resume-1" },
				interaction: {
					taskId: "task-1",
					turnId: "resume-turn",
					interactionId: "resume-1",
					kind: "resume",
					status: "resolving",
					createdRevision: 1,
					anchor: { messageTs: 100, messageType: "ask" },
				},
			},
			{
				type: "TASK_RESUME_REQUESTED",
				interactionId: "resume-1",
				draft: { text: "Continue", images: [], files: [] },
			},
		)

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.RESUMING, anchor: { interactionId: undefined } },
		})
		expect(result.next.interaction).toBeUndefined()
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW", "START_API", "PERSIST_SNAPSHOT"])
		expect(result.effects[1]).toMatchObject({
			type: "START_API",
			apiIndex: 1,
			draft: { text: "Continue", images: [], files: [] },
		})
	})

	it("records normal completion", () => {
		const result = reduceTask(stateAt(TaskPhase.STREAMING), {
			type: "TASK_COMPLETED",
			completionId: "completion-1",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.COMPLETED, completion: { completionId: "completion-1" } },
		})
	})

	it("turns effect failures into explicit recovery state", () => {
		const result = reduceTask(stateAt(TaskPhase.STREAMING), {
			type: "EFFECT_FAILED",
			effectId: "effect-1",
			effectType: "START_API",
			message: "provider unavailable",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.PAUSED,
				error: { effectId: "effect-1", effectType: "START_API", message: "provider unavailable" },
			},
		})
	})

	it("rejects an invalid event without mutation or effects", () => {
		const state = stateAt(TaskPhase.IDLE)
		const result = reduceTask(state, { type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toEqual({
			accepted: false,
			next: state,
			effects: [],
			error: {
				code: "invalid_runtime_event",
				eventType: "TASK_CANCEL_REQUESTED",
				phase: TaskPhase.IDLE,
			},
		})
	})
})
