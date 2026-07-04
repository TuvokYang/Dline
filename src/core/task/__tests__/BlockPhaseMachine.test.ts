import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { BlockPhase, BlockPhaseMachine } from "../BlockPhaseMachine"

/**
 * Tests for BlockPhaseMachine — validates approval cascade behavior
 * that causes the "approve button grays out / task hangs" bug when
 * two conversational tools (e.g. qna_respond) appear in the same turn.
 *
 * Scenario: AI returns two qna_respond tool calls in one response.
 * handleWebviewAskResponse treats messageResponse as rejection for ALL tools,
 * including conversational ones. rejectActiveBlock then marks block 0 as
 * REJECTED and cascades SKIPPED to block 1. Since block 1 is now SKIPPED,
 * its handler's ask() is never called → the task loop deadlocks.
 */

describe("BlockPhaseMachine - rejectActiveBlock cascade", () => {
	// ── Helper ──

	function createMachineWithTwoConversationalBlocks(autoApprove = false): {
		machine: BlockPhaseMachine
		callIds: string[]
	} {
		const machine = new BlockPhaseMachine()
		const callIds = ["call_qna_0", "call_qna_1"]

		const blocks = [
			{ type: "tool_use" as const, name: "qna_respond", call_id: callIds[0], ts: 100 },
			{ type: "tool_use" as const, name: "qna_respond", call_id: callIds[1], ts: 200 },
		]

		machine.buildTurn(blocks, (_toolName, _callId) => autoApprove)
		return { machine, callIds }
	}

	// ── Rejection cascade ──

	it("rejectActiveBlock cascades SKIPPED to subsequent approval-requiring blocks", () => {
		const { machine, callIds } = createMachineWithTwoConversationalBlocks()

		// Advance first block to AWAITING_APPROVAL
		const event0 = machine.advance(callIds[0], true)
		assert.equal(event0.type, "awaiting-approval")
		assert.equal(event0.callId, callIds[0])

		// Verify first block is awaiting approval
		const active0 = machine.getActiveBlock()
		assert.equal(active0?.callId, callIds[0])
		assert.equal(active0?.phase, BlockPhase.AWAITING_APPROVAL)

		// Reject active block (as handleWebviewAskResponse does for messageResponse)
		const rejected = machine.rejectActiveBlock()
		assert.ok(rejected, "rejectActiveBlock should return the rejected block")
		assert.equal(rejected.callId, callIds[0])
		assert.equal(rejected.phase, BlockPhase.REJECTED)

		// Verify cascade: second block should be SKIPPED
		const blocks = machine.getBlocks()
		const block0 = blocks.find((b) => b.callId === callIds[0])
		const block1 = blocks.find((b) => b.callId === callIds[1])

		assert.equal(block0?.phase, BlockPhase.REJECTED, "First block should be REJECTED")
		assert.equal(block1?.phase, BlockPhase.SKIPPED, "Second block should be cascaded SKIPPED")
	})

	// ── shouldSkip ──

	it("shouldSkip returns true for cascaded SKIPPED block", () => {
		const { machine, callIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject
		machine.advance(callIds[0], true)
		machine.rejectActiveBlock()

		assert.equal(machine.shouldSkip(callIds[0]), false, "REJECTED block should NOT match shouldSkip")
		assert.equal(machine.shouldSkip(callIds[1]), true, "SKIPPED block should match shouldSkip")
	})

	// ── releaseToken after cascade ──

	it("releaseToken returns null when only SKIPPED/REJECTED blocks remain", () => {
		const { machine, callIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject (cascades second to SKIPPED)
		machine.advance(callIds[0], true)
		machine.rejectActiveBlock()

		// Explicitly call releaseToken — should find no next approval block
		const next = machine.releaseToken()
		assert.equal(next, null, "releaseToken should return null when all remaining blocks are terminal")
	})

	// ── isTurnComplete after cascade ──

	it("isTurnComplete is true after rejectActiveBlock cascade", () => {
		const { machine, callIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject
		machine.advance(callIds[0], true)
		machine.rejectActiveBlock()

		assert.equal(machine.isTurnComplete, true, "Turn should be complete when all blocks are terminal")
	})

	// ── rejectActiveBlock does NOT cascade auto-approved blocks ──

	it("rejectActiveBlock does NOT cascade SKIPPED to auto-approved blocks", () => {
		const machine = new BlockPhaseMachine()

		const blocks = [
			{ type: "tool_use" as const, name: "execute_command", call_id: "ec1", ts: 100 },
			{ type: "tool_use" as const, name: "read_file", call_id: "rf1", ts: 200 },
		]

		// execute_command requires approval, read_file is auto-approved
		machine.buildTurn(blocks, (toolName) => toolName === "read_file")

		// Advance execute_command to AWAITING_APPROVAL (read_file goes to AUTO_EXECUTING)
		const event0 = machine.advance("ec1", true)
		assert.equal(event0.type, "awaiting-approval")

		// read_file should auto-execute
		const event1 = machine.advance("rf1", true)
		assert.equal(event1.type, "auto-execute")

		// Reject execute_command
		machine.rejectActiveBlock()

		const allBlocks = machine.getBlocks()
		const ecBlock = allBlocks.find((b) => b.callId === "ec1")
		const rfBlock = allBlocks.find((b) => b.callId === "rf1")

		assert.equal(ecBlock?.phase, BlockPhase.REJECTED, "execute_command should be REJECTED")
		assert.equal(rfBlock?.phase, BlockPhase.AUTO_EXECUTING, "auto-approved read_file should NOT be SKIPPED")
	})

	// ── restoreTurn preserves cascade state ──

	it("restoreTurn correctly restores REJECTED/SKIPPED phases for resume", () => {
		const { machine, callIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject (cascades second to SKIPPED)
		machine.advance(callIds[0], true)
		machine.rejectActiveBlock()

		// Snapshot blocks
		const blocks = machine.getBlocks()

		// Restore into a new machine
		const restoredMachine = new BlockPhaseMachine()
		restoredMachine.restoreTurn(
			blocks.map((b) => ({
				callId: b.callId,
				toolName: b.toolName,
				phase: b.phase,
				conversationHistoryIndex: b.conversationHistoryIndex,
			})),
		)

		const restoredBlocks = restoredMachine.getBlocks()
		const r0 = restoredBlocks.find((b) => b.callId === callIds[0])
		const r1 = restoredBlocks.find((b) => b.callId === callIds[1])

		assert.equal(r0?.phase, BlockPhase.REJECTED, "Restored: first block should be REJECTED")
		assert.equal(r1?.phase, BlockPhase.SKIPPED, "Restored: second block should be SKIPPED")
		assert.equal(restoredMachine.isTurnComplete, true, "Restored turn should be complete")
		assert.equal(restoredMachine.shouldSkip(callIds[1]), true, "Restored: shouldSkip should work on SKIPPED block")
	})
})
