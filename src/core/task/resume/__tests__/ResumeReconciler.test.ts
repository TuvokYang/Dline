import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, type TaskSnapshot } from "../../TaskSnapshot"
import { type ResumeEntry, type ResumeInput, selectResumeUiTail } from "../ResumeInput"
import { reconcileResume } from "../ResumeReconciler"

const TASK_ID = "task-1"
const TURN_ID = "turn-1"
const TID = "tid-1"

/** Create a strict v2 snapshot with optional canonical runtime fields. */
function snapshot(
	options: {
		phase?: TaskPhase
		interaction?: "tool_approval" | "status_acknowledgment" | "qna_response" | "mistake_limit" | "completion" | "resume"
		interactionStatus?: "opening" | "awaiting" | "resolving"
		cancellationFromPhase?: TaskPhase
		blocks?: Array<{ dlineTid: string; phase: BlockPhase }>
	} = {},
): TaskSnapshot {
	const state = createTaskRuntimeState({
		taskId: TASK_ID,
		phase: options.phase ?? TaskPhase.STREAMING,
		revision: 4,
		anchor: { apiIndex: 1, turnId: TURN_ID },
	})
	if (options.blocks) {
		state.turn = {
			turnId: TURN_ID,
			assistantApiIndex: 1,
			mode: "serial",
			blocks: options.blocks.map((block) => ({
				...block,
				functionId: `function-${block.dlineTid}`,
				toolName: "read_file",
				ts: 90,
				requiresApproval: false,
				conversationHistoryIndex: 1,
			})),
		}
	}
	if (options.interaction) {
		state.anchor.interactionId = TID
		state.interaction = {
			taskId: TASK_ID,
			turnId: TURN_ID,
			interactionId: TID,
			kind: options.interaction,
			status: options.interactionStatus ?? "awaiting",
			createdRevision: 3,
			anchor: options.interactionStatus === "opening" ? undefined : { messageTs: 100, messageType: "ask" },
			...(options.interactionStatus === "resolving"
				? {
						acceptedResponse: {
							taskId: TASK_ID,
							turnId: TURN_ID,
							interactionId: TID,
							actionId: "approve" as const,
							stateRevision: 4,
						},
					}
				: {}),
		}
	}
	if (options.cancellationFromPhase) {
		state.cancellation = { source: "system", fromPhase: options.cancellationFromPhase }
	}
	if (options.phase === TaskPhase.COMPLETED) {
		state.completion = { completionId: TID }
	}
	return createSnapshot(state, 95)
}

/** Create one persisted UI message. */
function ui(ts: number, type: "ask" | "say", kind: string, apiIndex = 1): ClineMessage {
	return {
		ts,
		type,
		...(type === "ask" ? { ask: kind as ClineMessage["ask"] } : { say: kind as ClineMessage["say"] }),
		text: "{}",
		conversationHistoryIndex: apiIndex,
	}
}

/** Create one canonical assistant tool turn. */
function assistantTool(dlineTid = TID): ClineStorageMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				name: "read_file",
				input: {},
				function_id: `function-${dlineTid}`,
				dline_tid: dlineTid,
				provider_metadata: { item_id: `item-${dlineTid}` },
			},
		],
	}
}

/** Create one canonical user tool result. */
function toolResult(dlineTid = TID): ClineStorageMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				content: "ok",
				function_id: `function-${dlineTid}`,
				dline_tid: dlineTid,
				provider_metadata: { item_id: `result-${dlineTid}` },
			},
		],
	}
}

function input(taskSnapshot: TaskSnapshot, uiTail: ClineMessage[] = [], apiTail: ClineStorageMessage[] = []): ResumeInput {
	return {
		taskId: TASK_ID,
		snapshot: taskSnapshot,
		uiTail,
		apiTail,
		apiHistoryLength: taskSnapshot.apiIndex + 1 + apiTail.length,
	}
}

function expectEntry(taskSnapshot: TaskSnapshot, entry: ResumeEntry): void {
	expect(reconcileResume(input(taskSnapshot))).toMatchObject({ entry, diagnostics: [] })
}

describe("reconcileResume", () => {
	it("gates an unblocked historical snapshot behind an explicit resume interaction", () => {
		const result = reconcileResume(input(snapshot()))

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.diagnostics).toEqual([])
	})

	it("selects an opening ask by canonical identity even when its timestamp equals the snapshot", () => {
		const opening = snapshot()
		opening.interaction = {
			taskId: TASK_ID,
			turnId: "resume-turn",
			interactionId: "resume-opening",
			kind: "resume",
			status: "opening",
			createdRevision: 3,
		}
		opening.anchor = { apiIndex: 1, turnId: "resume-turn", interactionId: "resume-opening" }
		const sameTimestampAsk: ClineMessage = {
			ts: opening.timestamp,
			type: "ask",
			ask: "resume_task",
			text: "Resume",
			interactionId: "resume-opening",
		}

		expect(
			selectResumeUiTail(opening, [
				{ ...sameTimestampAsk, ts: opening.timestamp + 1, interactionId: "other-interaction" },
				sameTimestampAsk,
			]),
		).toEqual([sameTimestampAsk])
	})

	it("rebinds an opening interaction only to its exact persisted ask identity", () => {
		const opening = snapshot()
		opening.phase = TaskPhase.PAUSED
		opening.interaction = {
			taskId: "task-1",
			turnId: "resume-turn",
			interactionId: "resume-opening",
			kind: "resume",
			status: "opening",
			createdRevision: 3,
		}
		opening.anchor = { apiIndex: 1, turnId: "resume-turn", interactionId: "resume-opening" }
		const resumeInput = input(opening)
		resumeInput.uiTail = [
			{
				ts: 110,
				type: "ask",
				ask: "resume_task",
				text: "Resume",
				interactionId: "resume-opening",
			},
		]

		const result = reconcileResume(resumeInput)

		expect(result.entry).toEqual({
			type: "show_resume_interaction",
			interactionId: "resume-opening",
			turnId: "resume-turn",
		})
		expect(result.snapshot.interaction).toMatchObject({
			interactionId: "resume-opening",
			status: "awaiting",
			anchor: { messageTs: 110, messageType: "ask" },
		})
	})

	it("falls back to a safe Resume gate when an opening interaction has no provable ask identity", () => {
		const opening = snapshot()
		opening.phase = TaskPhase.PAUSED
		opening.interaction = {
			taskId: "task-1",
			turnId: "resume-turn",
			interactionId: "resume-opening",
			kind: "resume",
			status: "opening",
			createdRevision: 3,
		}
		opening.anchor = { apiIndex: 1, turnId: "resume-turn", interactionId: "resume-opening" }
		const resumeInput = input(opening)
		resumeInput.uiTail = [{ ts: 110, type: "ask", ask: "resume_task", text: "Legacy ask without identity" }]

		const result = reconcileResume(resumeInput)

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toBeUndefined()
		expect(result.diagnostics).toEqual([{ code: "missing_interaction_anchor", interactionId: "resume-opening" }])
	})

	it("falls back safely when an opening interaction has no causal persisted anchor", () => {
		const result = reconcileResume(
			input(snapshot({ interaction: "qna_response", interactionStatus: "opening" }), [
				ui(100, "ask", "qna_respond"),
				ui(110, "say", "user_feedback"),
			]),
		)
		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.diagnostics).toEqual([{ code: "missing_interaction_anchor", interactionId: TID }])
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toBeUndefined()
	})

	it("falls back safely for completion opening tails without causal identity", () => {
		const result = reconcileResume(
			input(snapshot({ phase: TaskPhase.COMPLETED, interaction: "completion", interactionStatus: "opening" }), [
				ui(100, "ask", "completion_result"),
			]),
		)
		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.diagnostics).toEqual([{ code: "missing_interaction_anchor", interactionId: TID }])
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toBeUndefined()
	})

	it("reopens an existing resume interaction with its canonical identity", () => {
		const result = reconcileResume(input(snapshot({ phase: TaskPhase.PAUSED, interaction: "resume" })))
		expect(result.entry).toEqual({
			type: "show_resume_interaction",
			interactionId: TID,
			turnId: TURN_ID,
		})
	})

	it("does not consume an awaiting interaction from unrelated UI or API tails", () => {
		const unrelatedFeedback = ui(100, "say", "user_feedback", 9)
		unrelatedFeedback.text = "Unrelated"
		const result = reconcileResume(
			input(
				snapshot({ interaction: "qna_response" }),
				[ui(100, "ask", "qna_respond", 9), unrelatedFeedback, ui(101, "say", "api_req_started", 9)],
				[{ role: "user", content: "unrelated continuation" }],
			),
		)

		expect(result.entry).toEqual({ type: "reopen_interaction", interactionId: TID, turnId: TURN_ID })
		expect(result.snapshot.interaction).toMatchObject({ status: "awaiting", interactionId: TID })
		expect(result.snapshot.anchor?.apiIndex).toBe(1)
	})

	it.each([
		"awaiting",
		"resolving",
	] as const)("replays the original tool block for a %s approval interaction", (interactionStatus) => {
		const taskSnapshot = snapshot({
			phase: TaskPhase.AWAITING_APPROVAL,
			interaction: "tool_approval",
			interactionStatus,
			blocks: [{ dlineTid: TID, phase: BlockPhase.AWAITING_APPROVAL }],
		})

		const result = reconcileResume(input(taskSnapshot, [], [assistantTool()]))

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: TURN_ID,
			dlineTids: [TID],
			answeredDlineTids: [],
		})
		expect(result.snapshot.interaction).toMatchObject({
			kind: "tool_approval",
			status: interactionStatus,
			interactionId: TID,
		})
	})

	it("replays the original tool block for utility interactions that finish inside their handlers", () => {
		const taskSnapshot = snapshot({
			phase: TaskPhase.AWAITING_APPROVAL,
			interaction: "status_acknowledgment",
			blocks: [{ dlineTid: TID, phase: BlockPhase.AWAITING_APPROVAL }],
		})

		const result = reconcileResume(input(taskSnapshot, [], [assistantTool()]))

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: TURN_ID,
			dlineTids: [TID],
			answeredDlineTids: [],
		})
	})

	it("fails read-only instead of consuming an interaction without a typed continuation or original block", () => {
		const result = reconcileResume(input(snapshot({ phase: TaskPhase.AWAITING_APPROVAL, interaction: "mistake_limit" })))

		expect(result.entry).toEqual({
			type: "read_only_failure",
			diagnostics: [{ code: "missing_interaction_continuation", interactionId: TID }],
		})
		expect(result.snapshot.interaction).toMatchObject({
			kind: "mistake_limit",
			status: "awaiting",
		})
	})

	it("replays only unfinished blocks from a partially answered multi-tool turn", () => {
		const taskSnapshot = snapshot({
			phase: TaskPhase.EXECUTING,
			blocks: [
				{ dlineTid: "tid-1", phase: BlockPhase.EXECUTING },
				{ dlineTid: "tid-2", phase: BlockPhase.STREAMING },
			],
		})
		const result = reconcileResume(input(taskSnapshot, [], [assistantTool("tid-1"), toolResult("tid-1")]))
		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: TURN_ID,
			dlineTids: ["tid-2"],
			answeredDlineTids: ["tid-1"],
		})
		expect(result.snapshot.turn?.blocks[0]?.phase).toBe(BlockPhase.COMPLETED)
	})

	it("repairs an off-by-one assistant index from a persisted tool turn", () => {
		const taskSnapshot = snapshot({
			blocks: [{ dlineTid: TID, phase: BlockPhase.AUTO_EXECUTING }],
		})
		taskSnapshot.apiIndex = 0
		taskSnapshot.anchor = { apiIndex: 0, turnId: TURN_ID }
		if (taskSnapshot.turn) taskSnapshot.turn.assistantApiIndex = 2

		const result = reconcileResume(input(taskSnapshot, [], [assistantTool()]))

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: TURN_ID,
			dlineTids: [TID],
			answeredDlineTids: [],
		})
		expect(result.snapshot.turn?.assistantApiIndex).toBe(1)
		expect(result.diagnostics).toEqual([])
	})

	it("preserves rejected and skipped blocks while replaying remaining work", () => {
		const taskSnapshot = snapshot({
			blocks: [
				{ dlineTid: "tid-1", phase: BlockPhase.REJECTED },
				{ dlineTid: "tid-2", phase: BlockPhase.SKIPPED },
				{ dlineTid: "tid-3", phase: BlockPhase.STREAMING },
			],
		})
		const result = reconcileResume(input(taskSnapshot))
		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: TURN_ID,
			dlineTids: ["tid-3"],
			answeredDlineTids: [],
		})
	})

	it("does not consume a completion interaction from unrelated feedback or API markers", () => {
		const result = reconcileResume(
			input(snapshot({ phase: TaskPhase.COMPLETED, interaction: "completion" }), [
				ui(100, "say", "user_feedback", 9),
				ui(101, "say", "api_req_started", 9),
			]),
		)
		expect(result.entry).toEqual({
			type: "show_completion_interaction",
			interactionId: TID,
			turnId: TURN_ID,
		})
		expect(result.snapshot.completion).toEqual({ completionId: TID })
		expect(result.snapshot.interaction).toMatchObject({ status: "awaiting", interactionId: TID })
	})

	it("shows resume interaction when cancel cleanup was interrupted", () => {
		const result = reconcileResume(input(snapshot({ phase: TaskPhase.CANCELLING })))

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.cancellation).toBeUndefined()
	})

	it("restores a legacy completed interaction cleared by interrupted cancellation", () => {
		const legacyCompleted = snapshot({
			phase: TaskPhase.COMPLETED,
			blocks: [{ dlineTid: TID, phase: BlockPhase.AUTO_EXECUTING }],
		})
		legacyCompleted.phase = TaskPhase.CANCELLING
		legacyCompleted.anchor = {
			apiIndex: 1,
			turnId: TURN_ID,
			uiMessageTs: 100,
			interactionId: TID,
		}
		legacyCompleted.turn = {
			turnId: TURN_ID,
			assistantApiIndex: 2,
			mode: "parallel",
			blocks: [
				{
					dlineTid: TID,
					functionId: `function-${TID}`,
					toolName: "attempt_completion",
					ts: 100,
					requiresApproval: false,
					conversationHistoryIndex: 1,
					phase: BlockPhase.AUTO_EXECUTING,
				},
			],
		}
		legacyCompleted.cancellation = { source: "system", fromPhase: TaskPhase.COMPLETED }
		legacyCompleted.interaction = undefined

		const result = reconcileResume(input(legacyCompleted))

		expect(result.entry).toEqual({
			type: "show_completion_interaction",
			interactionId: TID,
			turnId: TURN_ID,
		})
		expect(result.snapshot.phase).toBe(TaskPhase.COMPLETED)
		expect(result.snapshot.cancellation).toBeUndefined()
		expect(result.snapshot.interaction).toEqual({
			taskId: TASK_ID,
			turnId: TURN_ID,
			interactionId: TID,
			kind: "completion",
			status: "awaiting",
			createdRevision: 4,
			anchor: { messageTs: 100, messageType: "ask" },
		})
	})

	it("does not infer legacy completion when the completion block identity disagrees", () => {
		const mismatched = snapshot({
			phase: TaskPhase.COMPLETED,
			blocks: [{ dlineTid: "other-tid", phase: BlockPhase.AUTO_EXECUTING }],
		})
		mismatched.phase = TaskPhase.CANCELLING
		mismatched.anchor = {
			apiIndex: 1,
			turnId: TURN_ID,
			uiMessageTs: 100,
			interactionId: TID,
		}
		mismatched.turn = {
			turnId: TURN_ID,
			assistantApiIndex: 2,
			mode: "parallel",
			blocks: [
				{
					dlineTid: "other-tid",
					functionId: "function-other-tid",
					toolName: "attempt_completion",
					ts: 100,
					requiresApproval: false,
					conversationHistoryIndex: 1,
					phase: BlockPhase.AUTO_EXECUTING,
				},
			],
		}
		mismatched.cancellation = { source: "system", fromPhase: TaskPhase.COMPLETED }
		mismatched.interaction = undefined

		const result = reconcileResume(input(mismatched))

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toBeUndefined()
	})

	it("restores cancellation provenance before reopening a preserved interaction", () => {
		const result = reconcileResume(
			input(
				snapshot({
					phase: TaskPhase.CANCELLING,
					interaction: "qna_response",
					cancellationFromPhase: TaskPhase.AWAITING_APPROVAL,
				}),
			),
		)

		expect(result.entry).toEqual({ type: "reopen_interaction", interactionId: TID, turnId: TURN_ID })
		expect(result.snapshot.phase).toBe(TaskPhase.AWAITING_APPROVAL)
		expect(result.snapshot.cancellation).toBeUndefined()
	})

	it("repairs only the synthetic resume anchor written one past persisted history", () => {
		const taskSnapshot = snapshot({ phase: TaskPhase.CANCELLING })
		taskSnapshot.apiIndex = 145
		taskSnapshot.anchor = {
			apiIndex: 145,
			turnId: `resume:${TASK_ID}`,
			interactionId: `resume:${TASK_ID}`,
			uiMessageTs: 1784731755250,
		}
		taskSnapshot.turn = undefined
		taskSnapshot.interaction = undefined
		taskSnapshot.cancellation = { source: "system", fromPhase: TaskPhase.PAUSED }
		taskSnapshot.runtimeError = {
			effectId: "resume_reconciliation",
			effectType: "PERSIST_SNAPSHOT",
			message: "corrupt_anchor",
		}

		const result = reconcileResume({
			...input(taskSnapshot),
			apiHistoryLength: 144,
		})

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.apiIndex).toBe(143)
		expect(result.snapshot.anchor).toEqual({ apiIndex: 143 })
		expect(result.snapshot.runtimeError).toBeUndefined()
		expect(result.diagnostics).toEqual([])
	})

	it("returns read-only failure for an API anchor beyond persisted history", () => {
		const taskSnapshot = snapshot()
		const result = reconcileResume({ ...input(taskSnapshot), apiHistoryLength: 1 })
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toContainEqual({ code: "corrupt_anchor", field: "apiIndex" })
	})

	it("returns read-only failure for a corrupt UI anchor", () => {
		const taskSnapshot = snapshot()
		taskSnapshot.anchor = { ...taskSnapshot.anchor, apiIndex: taskSnapshot.apiIndex, uiMessageTs: -1 }
		const result = reconcileResume(input(taskSnapshot))
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toContainEqual({ code: "corrupt_anchor", field: "uiMessageTs" })
	})

	it("returns read-only failure for a corrupt anchor", () => {
		const taskSnapshot = snapshot()
		taskSnapshot.anchor = { apiIndex: -2 }
		const result = reconcileResume(input(taskSnapshot))
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toContainEqual({ code: "corrupt_anchor", field: "apiIndex" })
	})

	it("returns read-only failure when canonical tool identity is missing", () => {
		const taskSnapshot = snapshot({ blocks: [{ dlineTid: TID, phase: BlockPhase.EXECUTING }] })
		if (taskSnapshot.turn) taskSnapshot.turn.blocks[0].dlineTid = ""
		const result = reconcileResume(input(taskSnapshot))
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toContainEqual({ code: "missing_identity", field: "dlineTid" })
	})
})
