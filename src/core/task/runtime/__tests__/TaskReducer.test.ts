import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { TaskPhase } from "../../TaskPhase"
import { reduceTask } from "../TaskReducer"
import { createTaskRuntimeState, type TaskRuntimeState } from "../TaskRuntimeState"

/** Create a runtime state restored to a focused test phase. */
function stateAt(phase: TaskPhase) {
	return createTaskRuntimeState({ taskId: "task-1", phase })
}

/** Create runtime state awaiting one causal tool approval response. */
function awaitingInteraction(): TaskRuntimeState & { interaction: NonNullable<TaskRuntimeState["interaction"]> } {
	return {
		...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.AWAITING_APPROVAL, revision: 4 }),
		interaction: {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "tool_approval",
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

	it("rejects an API continuation while an unfinished restored turn still owns execution", () => {
		const state = createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, anchor: { apiIndex: 3 } })
		state.turn = {
			turnId: "stale-turn",
			assistantApiIndex: 2,
			mode: "serial",
			blocks: [
				{
					dlineTid: "stale-tid",
					functionId: "stale-call",
					toolName: "status_update",
					phase: BlockPhase.AWAITING_APPROVAL,
					ts: 90,
					requiresApproval: true,
					conversationHistoryIndex: 2,
				},
			],
		}

		const result = reduceTask(state, { type: "RESUME_API_CONTINUATION_REQUESTED", apiIndex: 3 })

		expect(result).toMatchObject({ accepted: false, error: { code: "invalid_runtime_event" } })
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
							functionId: "call-1",
							toolName: "write_to_file",
							phase: BlockPhase.AWAITING_APPROVAL,
							ts: 90,
							requiresApproval: true,
							conversationHistoryIndex: 2,
						},
						{
							dlineTid: "tid-2",
							functionId: "call-2",
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

	it("persists accepted interaction input before the continuation consumes it", () => {
		const result = reduceTask(awaitingInteraction(), {
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 4,
				draft: { text: "Approval note", images: ["image"], files: ["file"] },
			},
		})

		expect(result.effects.map((effect) => effect.type)).toEqual(["APPEND_SAY", "POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
		expect(result.effects[0]).toMatchObject({
			type: "APPEND_SAY",
			interactionId: "interaction-1",
			taskSay: "user_feedback",
			presentation: "Approval note",
			images: ["image"],
			files: ["file"],
			feedbackAcknowledgment: "yesButtonClicked",
		})
	})

	it("does not expose the private mode compaction response as user feedback", () => {
		const state = awaitingInteraction()
		state.interaction.kind = "qna_response"
		const result = reduceTask(state, {
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "reply",
				stateRevision: 4,
				draft: { text: "__dline_mode_switch_compact__", images: [], files: [] },
			},
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

	it("keeps cancellation causal when an effect from an older revision fails late", () => {
		const state = {
			...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.CANCELLING, revision: 6 }),
			cancellation: { source: "user" as const, fromPhase: TaskPhase.EXECUTING },
			supersededEffectRevision: 5,
		}

		const failure = reduceTask(state, {
			type: "EFFECT_FAILED",
			effectId: "task-effect-5-2",
			effectType: "EXECUTE_TOOL",
			originRevision: 5,
			message: "Dline instance aborted",
		})
		const cancelled = reduceTask(failure.next, { type: "TASK_CANCELLED" })

		expect(failure).toEqual({ accepted: true, next: state, effects: [] })
		expect(cancelled).toMatchObject({ accepted: true, next: { phase: TaskPhase.PAUSED } })
	})

	it("still surfaces a failure owned by the current cancellation revision", () => {
		const state = {
			...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.CANCELLING, revision: 6 }),
			cancellation: { source: "user" as const, fromPhase: TaskPhase.EXECUTING },
			supersededEffectRevision: 5,
		}

		const result = reduceTask(state, {
			type: "EFFECT_FAILED",
			effectId: "task-effect-6-2",
			effectType: "CANCEL_RUNTIME",
			originRevision: 6,
			message: "cancel failed",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.PAUSED, error: { effectType: "CANCEL_RUNTIME", message: "cancel failed" } },
		})
	})

	it("starts resume only from a causal resolving resume interaction", () => {
		const draft = { text: "Continue", images: [], files: [] }
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
					acceptedResponse: {
						taskId: "task-1",
						turnId: "resume-turn",
						interactionId: "resume-1",
						actionId: "resume",
						stateRevision: 1,
						draft,
					},
				},
			},
			{
				type: "TASK_RESUME_REQUESTED",
				interactionId: "resume-1",
				draft,
			},
		)

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.RESUMING,
				anchor: { interactionId: "resume-1" },
				interaction: {
					kind: "resume",
					status: "resolving",
					acceptedResponse: { actionId: "resume", draft },
				},
			},
		})
		expect(result.effects.map((effect) => effect.type)).toEqual([
			"POST_TASK_VIEW",
			"PREPARE_RESUME",
			"APPEND_SAY",
			"START_API",
			"PERSIST_SNAPSHOT",
		])
		expect(result.effects[2]).toMatchObject({
			type: "APPEND_SAY",
			taskSay: "user_feedback",
			presentation: "Continue",
		})
		expect(result.effects[3]).toMatchObject({
			type: "START_API",
			apiIndex: 1,
			draft,
		})

		const admitted = reduceTask(result.next, { type: "API_REQUEST_STARTED", apiIndex: 1 })
		expect(admitted).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.STREAMING, anchor: { interactionId: undefined } },
		})
		expect(admitted.next.interaction).toBeUndefined()
	})

	it("does not append an empty timeline message when resume has no draft content", () => {
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
				draft: { text: "", images: [], files: [] },
			},
		)

		expect(result.effects.map((effect) => effect.type)).toEqual([
			"POST_TASK_VIEW",
			"PREPARE_RESUME",
			"START_API",
			"PERSIST_SNAPSHOT",
		])
	})

	it("abandons an unfinished pre-resume turn before starting a new API turn", () => {
		const state = {
			...stateAt(TaskPhase.PAUSED),
			anchor: { apiIndex: 1, turnId: "resume-turn", interactionId: "resume-1" },
			interaction: {
				taskId: "task-1",
				turnId: "resume-turn",
				interactionId: "resume-1",
				kind: "resume" as const,
				status: "resolving" as const,
				createdRevision: 1,
				anchor: { messageTs: 100, messageType: "ask" as const },
			},
			turn: {
				turnId: "stale-turn",
				assistantApiIndex: 2,
				mode: "serial" as const,
				activeDlineTid: "stale-tid",
				blocks: [
					{
						dlineTid: "stale-tid",
						functionId: "stale-call",
						toolName: "execute_command",
						phase: BlockPhase.EXECUTING,
						ts: 90,
						requiresApproval: false,
						conversationHistoryIndex: 2,
					},
				],
			},
		}

		const result = reduceTask(state, {
			type: "TASK_RESUME_REQUESTED",
			interactionId: "resume-1",
			draft: { text: "Continue", images: [], files: [] },
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.RESUMING,
				turn: { activeDlineTid: undefined, blocks: [{ phase: BlockPhase.CANCELLED }] },
			},
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
			originRevision: 0,
			message: "provider unavailable",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.PAUSED,
				interaction: {
					kind: "resume",
					status: "opening",
				},
				error: { effectId: "effect-1", effectType: "START_API", message: "provider unavailable" },
			},
		})
		expect(result.effects.map((effect) => effect.type)).toEqual(["PERSIST_SNAPSHOT", "APPEND_ASK"])
	})

	it("persists an opening Resume without retrying a failed ask presentation", () => {
		const state = {
			...stateAt(TaskPhase.STREAMING),
			interaction: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "question-1",
				kind: "qna_response" as const,
				status: "opening" as const,
				createdRevision: 1,
			},
		}

		const result = reduceTask(state, {
			type: "EFFECT_FAILED",
			effectId: "effect-ask",
			effectType: "APPEND_ASK",
			originRevision: 1,
			message: "ask persistence failed",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.PAUSED, interaction: { kind: "resume", status: "opening" } },
		})
		expect(result.effects.map((effect) => effect.type)).toEqual(["PERSIST_SNAPSHOT", "POST_TASK_VIEW"])
	})

	it("keeps an anchored approval actionable when only snapshot persistence fails", () => {
		const state = awaitingInteraction()
		const result = reduceTask(state, {
			type: "EFFECT_FAILED",
			effectId: "effect-snapshot",
			effectType: "PERSIST_SNAPSHOT",
			originRevision: state.revision,
			message: "snapshot unavailable",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.AWAITING_APPROVAL,
				interaction: { kind: "tool_approval", status: "awaiting", anchor: { messageType: "ask" } },
			},
		})
		expect(result.effects.map((effect) => effect.type)).toEqual(["POST_TASK_VIEW"])
	})

	it.each([
		{
			kind: "resume" as const,
			actionId: "resume" as const,
			phase: TaskPhase.RESUMING,
			failedPhase: TaskPhase.PAUSED,
		},
		{
			kind: "error_retry" as const,
			actionId: "retry" as const,
			phase: TaskPhase.STREAMING,
			failedPhase: TaskPhase.AWAITING_APPROVAL,
		},
		{
			kind: "mistake_limit" as const,
			actionId: "process_anyway" as const,
			phase: TaskPhase.STREAMING,
			failedPhase: TaskPhase.AWAITING_APPROVAL,
		},
	])("reopens $kind after its admitted START_API effect fails", ({ kind, actionId, phase, failedPhase }) => {
		const draft = { text: "keep this draft", images: ["image"], files: ["file"] }
		const state = {
			...stateAt(phase),
			revision: 6,
			interaction: {
				taskId: "task-1",
				turnId: "continuation-turn",
				interactionId: "continuation-1",
				kind,
				status: "resolving" as const,
				createdRevision: 4,
				anchor: { messageTs: 100, messageType: "ask" as const },
				acceptedResponse: {
					taskId: "task-1",
					turnId: "continuation-turn",
					interactionId: "continuation-1",
					actionId,
					stateRevision: 5,
					draft,
				},
			},
		}

		const result = reduceTask(state, {
			type: "EFFECT_FAILED",
			effectId: "effect-1",
			effectType: "START_API",
			originRevision: 6,
			message: "provider unavailable",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: failedPhase,
				interaction: {
					kind,
					status: "awaiting",
					createdRevision: 7,
					acceptedResponse: { actionId, draft },
				},
				error: { effectType: "START_API", message: "provider unavailable" },
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

// ── BLOCK_EXECUTION_COMPLETED — conversational tool path ──

describe("BLOCK_EXECUTION_COMPLETED — conversational tool lifecycle", () => {
	/** Create state with one turn and block in the given phase. */
	function stateWithBlock(blockPhase: BlockPhase, requiresApproval = false) {
		return {
			...createTaskRuntimeState({
				taskId: "task-1",
				phase: TaskPhase.EXECUTING,
				revision: 4,
				anchor: { apiIndex: 0, turnId: "turn-1" },
			}),
			turn: {
				turnId: "turn-1",
				assistantApiIndex: 2,
				mode: "serial" as const,
				activeDlineTid: blockPhase === BlockPhase.AWAITING_APPROVAL ? "tid-1" : undefined,
				blocks: [
					{
						dlineTid: "tid-1",
						functionId: "call-1",
						toolName: "qna_respond",
						phase: blockPhase,
						ts: 100,
						requiresApproval,
						conversationHistoryIndex: 2,
					},
				],
			},
		}
	}

	it("RED: BLOCK_EXECUTION_COMPLETED is rejected when block is AWAITING_APPROVAL (current bug symptom)", () => {
		const state = stateWithBlock(BlockPhase.AWAITING_APPROVAL, true)
		const result = reduceTask(state, {
			type: "BLOCK_EXECUTION_COMPLETED",
			turnId: "turn-1",
			dlineTid: "tid-1",
		})

		// This is the CORRECT behavior — reducer SHOULD reject completion for AWAITING_APPROVAL.
		// The bug is in the caller (index.ts) dispatching COMPLETED when block is AWAITING_APPROVAL.
		// This test documents the contract that callers must respect.
		expect(result).toMatchObject({ accepted: false })
		expect(result.error?.code).toBe("invalid_runtime_event")
	})

	it("BLOCK_EXECUTION_COMPLETED is accepted when block is AUTO_EXECUTING (expected path after fix)", () => {
		// After the fix, conversational tools will be auto-approved → AUTO_EXECUTING phase.
		// BLOCK_EXECUTION_COMPLETED should be accepted in this state.
		const state = stateWithBlock(BlockPhase.AUTO_EXECUTING, false)
		const result = reduceTask(state, {
			type: "BLOCK_EXECUTION_COMPLETED",
			turnId: "turn-1",
			dlineTid: "tid-1",
		})

		expect(result).toMatchObject({ accepted: true })
		expect(result.next.turn?.blocks[0]?.phase).toBe(BlockPhase.COMPLETED)
	})

	it("clears the approval owner when an approved block completes", () => {
		const state = stateWithBlock(BlockPhase.EXECUTING, true)
		state.turn.activeDlineTid = "tid-1"

		const result = reduceTask(state, {
			type: "BLOCK_EXECUTION_COMPLETED",
			turnId: "turn-1",
			dlineTid: "tid-1",
		})

		expect(result).toMatchObject({ accepted: true })
		expect(result.next.turn).toMatchObject({
			activeDlineTid: undefined,
			blocks: [{ dlineTid: "tid-1", phase: BlockPhase.COMPLETED }],
		})
	})

	it("preserves another block's approval owner when an automatic block completes", () => {
		const state = stateWithBlock(BlockPhase.AWAITING_APPROVAL, true)
		state.phase = TaskPhase.AWAITING_APPROVAL
		state.turn.activeDlineTid = "tid-1"
		state.turn.blocks.push({
			dlineTid: "tid-2",
			functionId: "fn-2",
			toolName: "read_file",
			phase: BlockPhase.AUTO_EXECUTING,
			ts: 2,
			requiresApproval: false,
			conversationHistoryIndex: 1,
		})

		const result = reduceTask(state, {
			type: "BLOCK_EXECUTION_COMPLETED",
			turnId: "turn-1",
			dlineTid: "tid-2",
		})

		expect(result).toMatchObject({ accepted: true })
		expect(result.next.turn).toMatchObject({
			activeDlineTid: "tid-1",
			blocks: [
				{ dlineTid: "tid-1", phase: BlockPhase.AWAITING_APPROVAL },
				{ dlineTid: "tid-2", phase: BlockPhase.COMPLETED },
			],
		})
	})
})
