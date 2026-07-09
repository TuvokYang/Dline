import { strict as assert } from "node:assert"
import { Task } from "@core/task"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { afterEach, describe, it, vi } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"
import type { MessageChannel } from "../MessageChannel"
import { TaskController } from "../TaskController"
import { TaskPhase } from "../TaskPhase"
import type { TaskSnapshot } from "../TaskSnapshot"

/**
 * Tests for Task.handleWebviewAskResponse — validates that conversational ask
 * types (qna_respond, plan_mode_respond, etc.) are NOT treated as rejections
 * when the user responds with messageResponse.
 *
 * Bug: handleWebviewAskResponse unconditionally calls rejectActiveBlock()
 * for messageResponse, which cascades SKIPPED to subsequent conversational
 * tools and causes the task loop to deadlock.
 */

type TaskSnapshotEmitter = {
	emitStateSnapshot(snapshot: TaskSnapshot): Promise<void>
}

// ── Helpers ──

function createMockChannel(): MessageChannel {
	return { say: vi.fn(), ask: vi.fn(), resolve: vi.fn() } as unknown as MessageChannel
}

/**
 * Creates a fake task object with just enough properties for
 * handleWebviewAskResponse to work. Uses a real TaskController so
 * the BlockPhaseMachine state changes are real.
 */
function createFakeTaskForHandleWebviewAskResponse(controller: TaskController, extra: Partial<Record<string, any>> = {}) {
	return {
		taskController: controller,
		taskState: { userMessageContent: [] },
		// resolveAsk is called first in handleWebviewAskResponse
		// postStateToWebview is called after transition
		// emitStateSnapshot is passed to transition as callback
		// flushTaskSnapshot is called after state transitions are persisted
		postStateToWebview: vi.fn(async () => {}),
		emitStateSnapshot: vi.fn(async () => {}),
		flushTaskSnapshot: vi.fn(async () => {}),
		// isParallelToolCallingEnabled is used in yesButtonClicked path
		isParallelToolCallingEnabled: vi.fn(() => true),
		...extra,
	}
}

/**
 * Builds a turn with two conversational tool blocks (e.g. qna_respond),
 * advances the first to AWAITING_APPROVAL, ready for handleWebviewAskResponse.
 */
function setupTwoConversationalBlocks(): {
	controller: TaskController
	callIds: string[]
} {
	const channel = createMockChannel()
	const controller = new TaskController(channel)

	const callIds = ["call_qna_0", "call_qna_1"]
	const blocks = [
		{ type: "tool_use" as const, name: "qna_respond", call_id: callIds[0], ts: 100 },
		{ type: "tool_use" as const, name: "qna_respond", call_id: callIds[1], ts: 200 },
	]

	// Build turn — none auto-approved (conversational tools are never auto-approved)
	controller.buildTurn(blocks, () => false)

	// Advance first block to AWAITING_APPROVAL
	controller.advance(callIds[0], true)

	return { controller, callIds }
}

// ── Tests ──

describe("Task.handleWebviewAskResponse", () => {
	// Ensure cleanup between tests
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("emitStateSnapshot schedules snapshot json without writing state_snapshot ui messages", async () => {
		const scheduledSnapshots: TaskSnapshot[] = []
		const say = vi.fn(async () => 123)
		const fakeTask = {
			say,
			snapshotPersistence: {
				schedule: (snapshot: TaskSnapshot) => {
					scheduledSnapshots.push(snapshot)
				},
			},
		}
		const snapshot: TaskSnapshot = { phase: TaskPhase.STREAMING, apiIndex: 2, timestamp: 300 }

		await (Task.prototype as unknown as TaskSnapshotEmitter).emitStateSnapshot.call(fakeTask, snapshot)

		assert.equal(scheduledSnapshots.length, 1)
		assert.deepEqual(scheduledSnapshots[0], snapshot)
		assert.equal(say.mock.calls.length, 0)
	})

	it("emitStateSnapshot immediately exposes OpenAI auth api_req_failed Retry button before deferred snapshot json write", async () => {
		const scheduledSnapshots: TaskSnapshot[] = []
		const fakeTask = {
			snapshotPersistence: {
				schedule: (snapshot: TaskSnapshot) => {
					scheduledSnapshots.push(snapshot)
				},
			},
		}
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.AWAITING_APPROVAL,
			apiIndex: 2,
			timestamp: 300,
			awaiting: { kind: "error_recovery", taskAsk: "api_req_failed", messageTs: 123 },
			error: {
				kind: "api_req_failed",
				sourceAsk: "api_req_failed",
				message: '{"message":"OpenAI API key or Azure Identity Authentication is required","providerId":"openai"}',
				actions: ["retry", "start_new_task"],
				retryable: true,
				processAllowed: false,
				messageTs: 123,
			},
		}

		await (Task.prototype as unknown as TaskSnapshotEmitter).emitStateSnapshot.call(fakeTask, snapshot)
		const uiState = new TaskController(createMockChannel()).buildTaskUiState(
			(fakeTask as { latestTaskSnapshot?: TaskSnapshot }).latestTaskSnapshot ?? null,
		)

		assert.deepEqual((fakeTask as { latestTaskSnapshot?: TaskSnapshot }).latestTaskSnapshot, snapshot)
		assert.equal(scheduledSnapshots.length, 1)
		assert.equal(uiState.phase, "awaiting_error_recovery")
		assert.equal(uiState.activeAsk, "api_req_failed")
		assert.equal(uiState.message, snapshot.error?.message)
		assert.equal(uiState.actions[0].type, "retry")
		assert.equal(uiState.actions[0].label, "Retry")
	})

	it("messageResponse with running feedback appends content for the next model turn", async () => {
		const channel = createMockChannel()
		const controller = new TaskController(channel)
		const userMessageContent: Array<{ type: "text"; text: string }> = []
		const say = vi.fn(async (_type: string, _text?: string) => 123)
		const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller, {
			say,
			taskState: { userMessageContent },
			checkpointManager: { saveCheckpoint: vi.fn(async () => {}) },
		})

		await Task.prototype.handleWebviewAskResponse.call(
			fakeTask,
			"messageResponse" as ClineAskResponse,
			"please use the new context",
		)

		assert.equal(say.mock.calls[0][0], "user_feedback")
		assert.equal(userMessageContent.length, 1)
		assert.equal(userMessageContent[0].type, "text")
		assert.match(userMessageContent[0].text, /<feedback>\nplease use the new context\n<\/feedback>/)
	})

	it("messageResponse with feedback text records visible feedback before returning without waiting for checkpoint", async () => {
		let resolveCheckpoint!: () => void
		let checkpointResolved = false
		const checkpointPromise = new Promise<void>((resolve) => {
			resolveCheckpoint = () => {
				checkpointResolved = true
				resolve()
			}
		})
		const channel = createMockChannel()
		const controller = new TaskController(channel)
		const say = vi.fn(async (_type: string, _text?: string) => 123)
		const saveCheckpoint = vi.fn(() => checkpointPromise)
		const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller, {
			say,
			checkpointManager: { saveCheckpoint },
		})

		await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse, "hello from My lord")

		assert.equal(say.mock.calls.length, 1)
		assert.equal(say.mock.calls[0][0], "user_feedback")
		assert.equal(say.mock.calls[0][1], "hello from My lord")
		assert.equal(saveCheckpoint.mock.calls.length, 1)
		assert.equal(checkpointResolved, false)

		resolveCheckpoint()
		await checkpointPromise
	})

	// =====================================================================
	// CONVERSATIONAL ASK — BUG REPRODUCTION (should FAIL before fix)
	// =====================================================================

	describe("BUG: conversational ask (qna_respond) messageResponse triggers rejectActiveBlock", () => {
		it("calling real handleWebviewAskResponse with messageResponse REJECTS qna_respond and SKIPS second tool", async () => {
			const { controller, callIds } = setupTwoConversationalBlocks()

			// Verify setup: first block is AWAITING_APPROVAL
			const activeBefore = controller.getActiveBlock()
			assert.ok(activeBefore, "First block should be AWAITING_APPROVAL before call")
			assert.equal(activeBefore.callId, callIds[0])

			// Create fake task and call the REAL method
			const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
			await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

			// BUG: messageResponse triggers rejectActiveBlock()
			// block0 → REJECTED, block1 → SKIPPED (cascade)
			const blocks = controller.getBlocks()
			const block0 = blocks.find((b) => b.callId === callIds[0])
			const block1 = blocks.find((b) => b.callId === callIds[1])

			// These assertions SHOULD FAIL with the current buggy code,
			// because block0 becomes REJECTED instead of staying AWAITING_APPROVAL
			assert.notEqual(
				block0?.phase,
				BlockPhase.REJECTED,
				"FIX: qna_respond block0 should NOT be REJECTED for messageResponse",
			)
			assert.notEqual(block1?.phase, BlockPhase.SKIPPED, "FIX: qna_respond block1 should NOT be cascaded SKIPPED")
		})

		it("after fix, isTurnComplete should be false for conversational ask messageResponse", async () => {
			const { controller } = setupTwoConversationalBlocks()

			const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
			await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

			// BUG: turn is complete because all blocks are REJECTED/SKIPPED
			// FIX: turn should NOT be complete
			assert.equal(
				controller.isTurnComplete,
				false,
				"FIX: turn should NOT be complete after conversational ask messageResponse",
			)
		})

		it("after fix, second block should NOT be shouldSkip", async () => {
			const { controller, callIds } = setupTwoConversationalBlocks()

			const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
			await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

			// BUG: second block is SKIPPED → shouldSkip returns true
			// FIX: second block should not be SKIPPED
			assert.equal(controller.shouldSkip(callIds[1]), false, "FIX: second qna_respond block should NOT be skipped")
		})
	})

	// =====================================================================
	// NON-CONVERSATIONAL TOOL — Should still reject correctly
	// =====================================================================

	describe("non-conversational tool (write_to_file) — should still reject", () => {
		it("messageResponse for write_to_file DOES reject the block", async () => {
			const channel = createMockChannel()
			const controller = new TaskController(channel)

			const callId = "call_wf_0"
			controller.buildTurn([{ type: "tool_use" as const, name: "write_to_file", call_id: callId, ts: 100 }], () => false)
			controller.advance(callId, true)

			const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
			await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

			const block = controller.getBlocks().find((b) => b.callId === callId)
			assert.equal(block?.phase, BlockPhase.REJECTED, "write_to_file should be REJECTED for messageResponse")
		})
	})

	// =====================================================================
	// ALL CONVERSATIONAL TOOL NAMES — Regression coverage
	// =====================================================================

	const CONVERSATIONAL_TOOL_NAMES = [
		"qna_respond",
		"plan_mode_respond",
		"act_mode_respond",
		"ask_followup_question",
		"generate_report",
	]

	for (const toolName of CONVERSATIONAL_TOOL_NAMES) {
		describe(`conversational tool "${toolName}"`, () => {
			it(`messageResponse should NOT reject active block`, async () => {
				const channel = createMockChannel()
				const controller = new TaskController(channel)

				const callId = "call_conv_0"
				controller.buildTurn([{ type: "tool_use" as const, name: toolName, call_id: callId, ts: 100 }], () => false)
				controller.advance(callId, true)

				const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
				await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

				const block = controller.getBlocks().find((b) => b.callId === callId)
				assert.notEqual(
					block?.phase,
					BlockPhase.REJECTED,
					`FIX: "${toolName}" should NOT be REJECTED for messageResponse`,
				)
			})
		})
	}

	// =====================================================================
	// RESUME SCENARIO — SKIPPED state should not persist on resume
	// =====================================================================

	describe("resume scenario", () => {
		it("after fix, conversational blocks are NOT cascaded SKIPPED on resume replay", async () => {
			const { controller, callIds } = setupTwoConversationalBlocks()

			const fakeTask = createFakeTaskForHandleWebviewAskResponse(controller)
			await Task.prototype.handleWebviewAskResponse.call(fakeTask, "messageResponse" as ClineAskResponse)

			// When resuming, the restored turn should not have SKIPPED blocks
			const block0 = controller.getBlocks().find((b) => b.callId === callIds[0])
			const block1 = controller.getBlocks().find((b) => b.callId === callIds[1])

			assert.notEqual(block0?.phase, BlockPhase.REJECTED, "Resume: block0 should NOT be REJECTED")
			assert.notEqual(block1?.phase, BlockPhase.SKIPPED, "Resume: block1 should NOT be SKIPPED")
		})
	})
})
