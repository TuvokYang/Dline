import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import type { InteractionKind } from "../../interaction/Interaction"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, type TaskSnapshot } from "../../TaskSnapshot"
import { type ResumeInput, selectResumeUiTail } from "../ResumeInput"
import { reconcileResume } from "../ResumeReconciler"

const TASK_ID = "task-resume"

function apiUser(content = "task"): ClineStorageMessage {
	return { role: "user", content }
}

function assistantTool(dlineTid: string, functionId: string, name = "read_file"): ClineStorageMessage {
	return {
		role: "assistant",
		ts: 200,
		content: [{ type: "tool_use", name, input: {}, function_id: functionId, dline_tid: dlineTid }],
	}
}

function assistantThinking(): ClineStorageMessage {
	return {
		role: "assistant",
		ts: 200,
		content: [{ type: "thinking", thinking: "Considering the next step.", signature: "thinking-signature" }],
	}
}

function toolResult(dlineTid: string, functionId: string): ClineStorageMessage {
	return {
		role: "user",
		content: [{ type: "tool_result", content: "ok", function_id: functionId, dline_tid: dlineTid }],
	}
}

function partialResult(dlineTid: string, functionId: string, ts = 210): ClineMessage {
	return {
		ts,
		type: "say",
		say: "partial_tool_result",
		conversationHistoryIndex: 1,
		text: JSON.stringify({ function_id: functionId, dline_tid: dlineTid, result: "durable" }),
	}
}

function interactionAsk(
	ask: NonNullable<ClineMessage["ask"]>,
	interactionId: string,
	conversationHistoryIndex = 1,
	ts = 205,
): ClineMessage {
	return { ts, type: "ask", ask, text: "{}", interactionId, conversationHistoryIndex }
}

function baseline(apiIndex = 0): TaskSnapshot {
	return createSnapshot(
		createTaskRuntimeState({
			taskId: TASK_ID,
			phase: TaskPhase.STREAMING,
			revision: 2,
			anchor: { apiIndex },
		}),
		100,
	)
}

function snapshotWithTurn(
	dlineTid: string,
	functionId: string,
	options: {
		toolName?: string
		blockPhase?: BlockPhase
		interaction?: InteractionKind
		interactionStatus?: "opening" | "awaiting" | "resolving"
	} = {},
): TaskSnapshot {
	const state = createTaskRuntimeState({
		taskId: TASK_ID,
		phase: options.interaction ? TaskPhase.AWAITING_APPROVAL : TaskPhase.EXECUTING,
		revision: 4,
		anchor: { apiIndex: 1, turnId: `turn:${dlineTid}` },
	})
	state.turn = {
		turnId: `turn:${dlineTid}`,
		assistantApiIndex: 1,
		mode: "serial",
		blocks: [
			{
				dlineTid,
				functionId,
				toolName: options.toolName ?? "read_file",
				phase: options.blockPhase ?? BlockPhase.EXECUTING,
				ts: 200,
				requiresApproval: Boolean(options.interaction),
				conversationHistoryIndex: 1,
			},
		],
	}
	if (options.interaction) {
		const status = options.interactionStatus ?? "awaiting"
		state.anchor = { ...state.anchor, interactionId: dlineTid, uiMessageTs: 205 }
		state.interaction = {
			taskId: TASK_ID,
			turnId: state.turn.turnId,
			interactionId: dlineTid,
			kind: options.interaction,
			status,
			createdRevision: 3,
			anchor: { messageTs: 205, messageType: "ask" },
			...(status === "resolving"
				? {
						acceptedResponse: {
							taskId: TASK_ID,
							turnId: state.turn.turnId,
							interactionId: dlineTid,
							actionId: "approve" as const,
							stateRevision: 4,
						},
					}
				: {}),
		}
	}
	return createSnapshot(state, 206)
}

function snapshotWithStandaloneInteraction(interactionId: string, kind: "resume" | "error_retry"): TaskSnapshot {
	const turnId = `turn:${interactionId}`
	const state = createTaskRuntimeState({
		taskId: TASK_ID,
		phase: kind === "resume" ? TaskPhase.PAUSED : TaskPhase.AWAITING_APPROVAL,
		revision: 4,
		anchor: { apiIndex: 0, turnId, interactionId, uiMessageTs: 205 },
	})
	state.interaction = {
		taskId: TASK_ID,
		turnId,
		interactionId,
		kind,
		status: "resolving",
		createdRevision: 3,
		anchor: { messageTs: 205, messageType: "ask" },
		acceptedResponse: {
			taskId: TASK_ID,
			turnId,
			interactionId,
			actionId: kind === "resume" ? "resume" : "retry",
			stateRevision: 4,
			draft: { text: "", images: [], files: [] },
		},
	}
	return createSnapshot(state, 206)
}

function fullInput(apiHistory: ClineStorageMessage[], uiHistory: ClineMessage[] = [], snapshot?: TaskSnapshot): ResumeInput {
	const start = snapshot ? snapshot.apiIndex + 1 : 0
	return {
		taskId: TASK_ID,
		snapshot,
		apiHistory,
		uiHistory,
		apiTail: apiHistory.slice(Math.max(0, start)),
		uiTail: snapshot ? selectResumeUiTail(snapshot, uiHistory) : uiHistory,
		apiTailStartIndex: Math.max(0, start),
		apiHistoryLength: apiHistory.length,
	}
}

describe("reconcileResume", () => {
	it("uses a valid snapshot as the baseline and folds every later API row", () => {
		const result = reconcileResume(
			fullInput([apiUser(), assistantTool("tid-1", "fn-1"), toolResult("tid-1", "fn-1")], [], baseline(0)),
		)

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.turn?.blocks).toMatchObject([{ dlineTid: "tid-1", phase: BlockPhase.COMPLETED }])
		expect(result.diagnostics).toEqual([])
	})

	it("rebuilds a missing snapshot from the complete histories", () => {
		const result = reconcileResume(fullInput([apiUser(), assistantTool("tid-1", "fn-1")], [partialResult("tid-1", "fn-1")]))

		expect(result.diagnostics).toContainEqual({ code: "snapshot_rebuilt", reason: "missing" })
		expect(result.snapshot.apiIndex).toBe(1)
		expect(result.snapshot.turn?.blocks).toMatchObject([{ dlineTid: "tid-1", phase: BlockPhase.COMPLETED }])
		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
	})

	it("rebuilds a corrupt snapshot instead of creating a read-only dead end", () => {
		const corrupt = baseline(0)
		corrupt.apiIndex = 99
		corrupt.anchor = { apiIndex: 99 }
		const result = reconcileResume(fullInput([apiUser(), assistantTool("tid-new", "fn-new")], [], corrupt))

		expect(result.diagnostics).toContainEqual({ code: "snapshot_rebuilt", reason: "corrupt_anchor" })
		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
	})

	it("uses the latest valid legacy JSONL snapshot before folding its stale tail", () => {
		const embedded = baseline(0)
		const uiHistory: ClineMessage[] = [
			{ ts: 101, type: "say", say: "state_snapshot", text: "{broken" },
			{ ts: 102, type: "say", say: "state_snapshot", text: JSON.stringify(embedded) },
		]
		const result = reconcileResume(fullInput([apiUser(), assistantTool("tid-tail", "fn-tail")], uiHistory))

		expect(result.diagnostics).toContainEqual({ code: "snapshot_rebuilt", reason: "missing" })
		expect(result.snapshot.anchor).toMatchObject({ apiIndex: 1, turnId: "turn:tid-tail" })
		expect(result.entry.type).toBe("show_resume_interaction")
	})

	it("keeps a pending approval as the original Approve/Reject interaction", () => {
		const apiHistory = [apiUser(), assistantTool("tid-approve", "fn-approve", "write_to_file")]
		const ask = interactionAsk("tool", "tid-approve")
		const result = reconcileResume(fullInput(apiHistory, [ask]))

		expect(result.entry).toEqual({
			type: "reopen_interaction",
			turnId: "turn:tid-approve",
			interactionId: "tid-approve",
		})
		expect(result.snapshot.phase).toBe(TaskPhase.AWAITING_APPROVAL)
		expect(result.snapshot.turn?.blocks[0]).toMatchObject({
			phase: BlockPhase.AWAITING_APPROVAL,
			requiresApproval: true,
		})
	})

	it.each([
		["followup", "followup"],
		["make_plan", "make_plan"],
		["qna_respond", "qna_response"],
		["generate_report", "generate_report"],
	] as const)("keeps awaiting %s as its original reply interaction", (ask, kind) => {
		const interactionId = `tid-${kind}`
		const snapshot = snapshotWithTurn(interactionId, `fn-${kind}`, {
			toolName: ask,
			interaction: kind,
			blockPhase: BlockPhase.EXECUTING,
		})
		const result = reconcileResume(
			fullInput(
				[apiUser(), assistantTool(interactionId, `fn-${kind}`, ask)],
				[interactionAsk(ask, interactionId)],
				snapshot,
			),
		)

		expect(result.entry).toEqual({
			type: "reopen_interaction",
			turnId: `turn:${interactionId}`,
			interactionId,
		})
		expect(result.snapshot.phase).toBe(TaskPhase.AWAITING_APPROVAL)
		expect(result.snapshot.interaction).toMatchObject({ kind, status: "awaiting" })
	})

	it("keeps attempt completion as Start New Task only", () => {
		const result = reconcileResume(
			fullInput(
				[apiUser(), assistantTool("tid-complete", "fn-complete", "attempt_completion")],
				[interactionAsk("completion_result", "tid-complete")],
			),
		)

		expect(result.entry).toEqual({
			type: "show_completion_interaction",
			turnId: "turn:tid-complete",
			interactionId: "tid-complete",
		})
		expect(result.snapshot.phase).toBe(TaskPhase.COMPLETED)
		expect(result.snapshot.interaction?.kind).toBe("completion")
	})

	it("keeps the same completion identity when reopening before its ask row was persisted", () => {
		const snapshot = snapshotWithTurn("tid-complete", "fn-complete", {
			toolName: "attempt_completion",
			interaction: "completion",
			interactionStatus: "opening",
			blockPhase: BlockPhase.COMPLETED,
		})
		snapshot.phase = TaskPhase.COMPLETED
		snapshot.completion = { completionId: "tid-complete" }
		const result = reconcileResume(
			fullInput([apiUser(), assistantTool("tid-complete", "fn-complete", "attempt_completion")], [], snapshot),
		)

		expect(result.entry).toEqual({
			type: "show_completion_interaction",
			turnId: "turn:tid-complete",
			interactionId: "tid-complete",
		})
		expect(result.snapshot.phase).toBe(TaskPhase.COMPLETED)
		expect(result.snapshot.interaction).toMatchObject({
			interactionId: "tid-complete",
			kind: "completion",
			status: "opening",
		})
		expect(result.entry.type).not.toBe("show_resume_interaction")
	})

	it("keeps API admission failure as Retry", () => {
		const result = reconcileResume(fullInput([apiUser()], [interactionAsk("api_req_failed", "retry-1", 0)]))

		expect(result.entry).toEqual({
			type: "show_error_recovery",
			turnId: "turn:retry-1",
			interactionId: "retry-1",
			apiIndex: 0,
		})
		expect(result.snapshot.interaction?.kind).toBe("error_retry")
	})

	it("uses a later durable result to retire a stale approval", () => {
		const snapshot = snapshotWithTurn("tid-approve", "fn-approve", {
			interaction: "tool_approval",
			blockPhase: BlockPhase.AWAITING_APPROVAL,
		})
		const ask = interactionAsk("tool", "tid-approve")
		const result = reconcileResume(
			fullInput(
				[apiUser(), assistantTool("tid-approve", "fn-approve")],
				[ask, partialResult("tid-approve", "fn-approve", 220)],
				snapshot,
			),
		)

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.interaction).toMatchObject({
			kind: "resume",
			status: "opening",
		})
		expect(result.snapshot.interaction?.interactionId).not.toBe("tid-approve")
		expect(result.snapshot.turn?.blocks[0]?.phase).toBe(BlockPhase.COMPLETED)
	})

	it("does not offer Approve again after an accepted response with unknown outcome", () => {
		const snapshot = snapshotWithTurn("tid-accepted", "fn-accepted", {
			interaction: "tool_approval",
			interactionStatus: "resolving",
			blockPhase: BlockPhase.EXECUTING,
		})
		const result = reconcileResume(
			fullInput(
				[apiUser(), assistantTool("tid-accepted", "fn-accepted")],
				[interactionAsk("tool", "tid-accepted")],
				snapshot,
			),
		)

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toMatchObject({
			kind: "resume",
			status: "opening",
		})
		expect(result.snapshot.interaction?.interactionId).not.toBe("tid-accepted")
	})

	it.each([
		["resume_task", "resume", "show_resume_interaction"],
		["api_req_failed", "error_retry", "show_error_recovery"],
	] as const)("reopens a resolving %s interaction as clickable awaiting", (ask, kind, entryType) => {
		const interactionId = `${kind}-resolving`
		const snapshot = snapshotWithStandaloneInteraction(interactionId, kind)
		const result = reconcileResume(fullInput([apiUser()], [interactionAsk(ask, interactionId, 0)], snapshot))

		expect(result.entry).toMatchObject({
			type: entryType,
			turnId: `turn:${interactionId}`,
			interactionId,
		})
		expect(result.snapshot.interaction).toMatchObject({
			interactionId,
			kind,
			status: "awaiting",
		})
		expect(result.snapshot.interaction?.acceptedResponse).toBeUndefined()
	})

	it.each([
		["qna_respond", "qna_respond"],
		["completion_result", "attempt_completion"],
	] as const)("does not revive a stale %s ask over a later paused snapshot", (ask, toolName) => {
		const snapshot = snapshotWithTurn("tid-stale", "fn-stale", {
			toolName,
			blockPhase: BlockPhase.COMPLETED,
		})
		snapshot.phase = TaskPhase.PAUSED
		const result = reconcileResume(
			fullInput(
				[apiUser(), assistantTool("tid-stale", "fn-stale", toolName)],
				[interactionAsk(ask, "tid-stale")],
				snapshot,
			),
		)

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toMatchObject({ kind: "resume", status: "opening" })
	})

	it("treats a thinking-only assistant tail with no original interaction as ordinary Resume", () => {
		const result = reconcileResume(fullInput([apiUser(), assistantThinking()], [], baseline(0)))

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.interaction).toMatchObject({ kind: "resume", status: "opening" })
		expect(result.snapshot.turn).toBeUndefined()
	})

	it("turns a runtime effect diagnostic into a stopped normal continuation", () => {
		const snapshot = baseline(0)
		snapshot.runtimeError = { effectId: "effect-1", effectType: "START_API", message: "provider stopped" }
		const result = reconcileResume(fullInput([apiUser()], [], snapshot))

		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.runtimeError).toBeUndefined()
		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.diagnostics).toContainEqual({ code: "unsafe_runtime_error", effectType: "START_API" })
	})

	it("falls back to normal Resume when the stored interaction ask is gone", () => {
		const snapshot = snapshotWithTurn("tid-missing", "fn-missing", { interaction: "qna_response" })
		const result = reconcileResume(fullInput([apiUser(), assistantTool("tid-missing", "fn-missing")], [], snapshot))

		expect(result.entry).toMatchObject({ type: "show_resume_interaction" })
		expect(result.snapshot.interaction).toMatchObject({
			kind: "resume",
			status: "opening",
		})
		expect(result.snapshot.interaction?.interactionId).not.toBe("tid-missing")
		expect(result.diagnostics).toContainEqual({
			code: "missing_interaction_anchor",
			interactionId: "tid-missing",
		})
	})

	it("selects same-index UI results written after a snapshot", () => {
		const snapshot = baseline(1)
		const before: ClineMessage = { ts: 99, type: "say", say: "text", conversationHistoryIndex: 1 }
		const after = partialResult("tid-1", "fn-1", 101)

		expect(selectResumeUiTail(snapshot, [before, after])).toEqual([after])
	})
})
