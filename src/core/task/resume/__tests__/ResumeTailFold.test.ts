import type { ClineStorageMessage } from "@shared/messages"
import { describe, expect, it } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, type TaskSnapshot } from "../../TaskSnapshot"
import type { ResumeInput } from "../ResumeInput"
import { reconcileResume } from "../ResumeReconciler"

const TASK_ID = "task-tail-fold"

function baseSnapshot(): TaskSnapshot {
	return createSnapshot(
		createTaskRuntimeState({
			taskId: TASK_ID,
			phase: TaskPhase.STREAMING,
			revision: 4,
			anchor: { apiIndex: 1 },
		}),
		100,
	)
}

function assistantTool(dlineTid: string, functionId: string, name = "read_file"): ClineStorageMessage {
	return {
		role: "assistant",
		ts: 200,
		content: [
			{
				type: "tool_use",
				name,
				input: {},
				function_id: functionId,
				dline_tid: dlineTid,
			},
		],
	}
}

function toolResult(dlineTid: string, functionId: string): ClineStorageMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				content: "ok",
				function_id: functionId,
				dline_tid: dlineTid,
			},
		],
	}
}

function input(apiTail: ClineStorageMessage[]): ResumeInput {
	return {
		taskId: TASK_ID,
		snapshot: baseSnapshot(),
		uiTail: [],
		apiTail,
		apiTailStartIndex: 2,
		apiHistoryLength: 2 + apiTail.length,
	}
}

describe("resume API tail fold", () => {
	it("rebuilds a pending turn from an assistant tool use after the snapshot anchor", () => {
		const result = reconcileResume(input([assistantTool("tid-new", "function-new")]))

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: "turn:tid-new",
			dlineTids: ["tid-new"],
			answeredDlineTids: [],
		})
		expect(result.snapshot.anchor).toMatchObject({ apiIndex: 2, turnId: "turn:tid-new" })
		expect(result.snapshot.turn).toMatchObject({
			turnId: "turn:tid-new",
			assistantApiIndex: 2,
			blocks: [
				{
					dlineTid: "tid-new",
					functionId: "function-new",
					toolName: "read_file",
					phase: BlockPhase.STREAMING,
					conversationHistoryIndex: 2,
				},
			],
		})
	})

	it("fails closed when a tool result matches dline_tid but not function_id", () => {
		const result = reconcileResume(
			input([assistantTool("tid-mismatch", "function-expected"), toolResult("tid-mismatch", "function-other")]),
		)

		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toEqual([
			{
				code: "tool_result_identity_mismatch",
				dlineTid: "tid-mismatch",
				expectedFunctionId: "function-expected",
				actualFunctionId: "function-other",
			},
		])
	})

	it("folds multiple turns using absolute API indexes", () => {
		const result = reconcileResume(
			input([
				assistantTool("tid-first", "function-first"),
				toolResult("tid-first", "function-first"),
				assistantTool("tid-second", "function-second"),
			]),
		)

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: "turn:tid-second",
			dlineTids: ["tid-second"],
			answeredDlineTids: [],
		})
		expect(result.snapshot.apiIndex).toBe(4)
		expect(result.snapshot.anchor).toMatchObject({ apiIndex: 4, turnId: "turn:tid-second" })
		expect(result.snapshot.turn?.assistantApiIndex).toBe(4)
	})

	it("restores attempt_completion as pending work without completing the task", () => {
		const result = reconcileResume(input([assistantTool("tid-completion", "function-completion", "attempt_completion")]))

		expect(result.entry).toEqual({
			type: "replay_pending_blocks",
			turnId: "turn:tid-completion",
			dlineTids: ["tid-completion"],
			answeredDlineTids: [],
		})
		expect(result.snapshot.phase).not.toBe(TaskPhase.COMPLETED)
		expect(result.snapshot.completion).toBeUndefined()
	})

	it("does not replay a block that already has its canonical tool result", () => {
		const result = reconcileResume(
			input([assistantTool("tid-done", "function-done"), toolResult("tid-done", "function-done")]),
		)

		expect(result.entry).toEqual({ type: "show_resume_interaction" })
		expect(result.snapshot.phase).toBe(TaskPhase.PAUSED)
		expect(result.snapshot.apiIndex).toBe(3)
		expect(result.snapshot.turn?.blocks).toMatchObject([{ dlineTid: "tid-done", phase: BlockPhase.COMPLETED }])
	})
})
