import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, type TaskSnapshot } from "../../TaskSnapshot"
import type { ResumeEntry, ResumeInput } from "../ResumeInput"
import { reconcileResume } from "../ResumeReconciler"

const TASK_ID = "task-1"
const TURN_ID = "turn-1"
const TID = "tid-1"

/** Create a strict v2 snapshot with optional canonical runtime fields. */
function snapshot(
	options: {
		phase?: TaskPhase
		interaction?: "qna_response" | "completion" | "resume"
		interactionStatus?: "opening" | "awaiting"
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
				callId: `call-${block.dlineTid}`,
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
		}
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
				id: `call-${dlineTid}`,
				name: "read_file",
				input: {},
				call_id: `call-${dlineTid}`,
				item_id: `item-${dlineTid}`,
				function_id: `call-${dlineTid}`,
				dline_tid: dlineTid,
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
				tool_use_id: `call-${dlineTid}`,
				content: "ok",
				call_id: `call-${dlineTid}`,
				item_id: `result-${dlineTid}`,
				function_id: `call-${dlineTid}`,
				dline_tid: dlineTid,
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
	it("continues an unblocked snapshot with no tail", () => {
		expectEntry(snapshot(), { type: "continue_api_turn", apiIndex: 1 })
	})

	it("fails read-only when an opening interaction has no causal persisted anchor", () => {
		const result = reconcileResume(
			input(snapshot({ interaction: "qna_response", interactionStatus: "opening" }), [
				ui(100, "ask", "qna_respond"),
				ui(110, "say", "user_feedback"),
			]),
		)
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toEqual([{ code: "missing_interaction_anchor", interactionId: TID }])
		expect(result.snapshot.interaction).toMatchObject({ status: "opening", interactionId: TID })
	})

	it("fails read-only for completion opening tails without causal identity", () => {
		const result = reconcileResume(
			input(snapshot({ phase: TaskPhase.COMPLETED, interaction: "completion", interactionStatus: "opening" }), [
				ui(100, "ask", "completion_result"),
			]),
		)
		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toEqual([{ code: "missing_interaction_anchor", interactionId: TID }])
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
		expectEntry(snapshot({ phase: TaskPhase.CANCELLING }), { type: "show_resume_interaction" })
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
