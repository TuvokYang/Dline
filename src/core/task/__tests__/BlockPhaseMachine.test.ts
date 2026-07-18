import { strict as assert } from "node:assert"
import { describe, expect, it } from "vitest"
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
		functionIds: string[]
	} {
		const machine = new BlockPhaseMachine()
		const functionIds = ["call_qna_0", "call_qna_1"]

		const blocks = [
			{ type: "tool_use" as const, name: "qna_respond", function_id: functionIds[0], dline_tid: functionIds[0], ts: 100 },
			{ type: "tool_use" as const, name: "qna_respond", function_id: functionIds[1], dline_tid: functionIds[1], ts: 200 },
		]

		machine.buildTurn(blocks, (_toolName, _functionId) => autoApprove)
		return { machine, functionIds }
	}

	it("uses dline_tid as the lifecycle key when provider call IDs are equal", () => {
		const machine = new BlockPhaseMachine()
		machine.buildTurn(
			[
				{
					type: "tool_use",
					name: "read_file",
					function_id: "call_shared",
					dline_tid: "dline_tid_first",
					ts: 100,
				},
				{
					type: "tool_use",
					name: "write_to_file",
					function_id: "call_shared",
					dline_tid: "dline_tid_second",
					ts: 200,
				},
			],
			() => true,
		)

		const first = machine.advance("dline_tid_first", true)
		const second = machine.advance("dline_tid_second", true)

		expect(first).toMatchObject({ type: "auto-execute", dlineTid: "dline_tid_first" })
		expect(second).toMatchObject({ type: "auto-execute", dlineTid: "dline_tid_second" })
		expect(machine.getBlocks().map((block) => block.dlineTid)).toEqual(["dline_tid_first", "dline_tid_second"])
	})

	// ── Rejection cascade ──

	it("rejectActiveBlock cascades SKIPPED to subsequent approval-requiring blocks", () => {
		const { machine, functionIds } = createMachineWithTwoConversationalBlocks()

		// Advance first block to AWAITING_APPROVAL
		const event0 = machine.advance(functionIds[0], true)
		assert.equal(event0.type, "awaiting-approval")
		assert.equal(event0.functionId, functionIds[0])

		// Verify first block is awaiting approval
		const active0 = machine.getActiveBlock()
		assert.equal(active0?.functionId, functionIds[0])
		assert.equal(active0?.phase, BlockPhase.AWAITING_APPROVAL)

		// Reject active block (as handleWebviewAskResponse does for messageResponse)
		const rejected = machine.rejectActiveBlock()
		assert.ok(rejected, "rejectActiveBlock should return the rejected block")
		assert.equal(rejected.functionId, functionIds[0])
		assert.equal(rejected.phase, BlockPhase.REJECTED)

		// Verify cascade: second block should be SKIPPED
		const blocks = machine.getBlocks()
		const block0 = blocks.find((b) => b.functionId === functionIds[0])
		const block1 = blocks.find((b) => b.functionId === functionIds[1])

		assert.equal(block0?.phase, BlockPhase.REJECTED, "First block should be REJECTED")
		assert.equal(block1?.phase, BlockPhase.SKIPPED, "Second block should be cascaded SKIPPED")
	})

	// ── shouldSkip ──

	it("shouldSkip returns true for cascaded SKIPPED block", () => {
		const { machine, functionIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject
		machine.advance(functionIds[0], true)
		machine.rejectActiveBlock()

		assert.equal(machine.shouldSkip(functionIds[0]), false, "REJECTED block should NOT match shouldSkip")
		assert.equal(machine.shouldSkip(functionIds[1]), true, "SKIPPED block should match shouldSkip")
	})

	// ── releaseToken after cascade ──

	it("releaseToken returns null when only SKIPPED/REJECTED blocks remain", () => {
		const { machine, functionIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject (cascades second to SKIPPED)
		machine.advance(functionIds[0], true)
		machine.rejectActiveBlock()

		// Explicitly call releaseToken — should find no next approval block
		const next = machine.releaseToken()
		assert.equal(next, null, "releaseToken should return null when all remaining blocks are terminal")
	})

	// ── isTurnComplete after cascade ──

	it("isTurnComplete is true after rejectActiveBlock cascade", () => {
		const { machine, functionIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject
		machine.advance(functionIds[0], true)
		machine.rejectActiveBlock()

		assert.equal(machine.isTurnComplete, true, "Turn should be complete when all blocks are terminal")
	})

	// ── rejectActiveBlock does NOT cascade auto-approved blocks ──

	it("rejectActiveBlock does NOT cascade SKIPPED to auto-approved blocks", () => {
		const machine = new BlockPhaseMachine()

		const blocks = [
			{ type: "tool_use" as const, name: "execute_command", function_id: "ec1", dline_tid: "ec1", ts: 100 },
			{ type: "tool_use" as const, name: "read_file", function_id: "rf1", dline_tid: "rf1", ts: 200 },
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
		const ecBlock = allBlocks.find((b) => b.functionId === "ec1")
		const rfBlock = allBlocks.find((b) => b.functionId === "rf1")

		assert.equal(ecBlock?.phase, BlockPhase.REJECTED, "execute_command should be REJECTED")
		assert.equal(rfBlock?.phase, BlockPhase.AUTO_EXECUTING, "auto-approved read_file should NOT be SKIPPED")
	})

	// ── restoreTurn preserves cascade state ──

	it("restoreTurn correctly restores REJECTED/SKIPPED phases for resume", () => {
		const { machine, functionIds } = createMachineWithTwoConversationalBlocks()

		// Set up: advance first → reject (cascades second to SKIPPED)
		machine.advance(functionIds[0], true)
		machine.rejectActiveBlock()

		// Snapshot blocks
		const blocks = machine.getBlocks()

		// Restore into a new machine
		const restoredMachine = new BlockPhaseMachine()
		restoredMachine.restoreTurn(
			blocks.map((b) => ({
				dlineTid: b.dlineTid,
				functionId: b.functionId,
				toolName: b.toolName,
				phase: b.phase,
				conversationHistoryIndex: b.conversationHistoryIndex,
			})),
		)

		const restoredBlocks = restoredMachine.getBlocks()
		const r0 = restoredBlocks.find((b) => b.functionId === functionIds[0])
		const r1 = restoredBlocks.find((b) => b.functionId === functionIds[1])

		assert.equal(r0?.phase, BlockPhase.REJECTED, "Restored: first block should be REJECTED")
		assert.equal(r1?.phase, BlockPhase.SKIPPED, "Restored: second block should be SKIPPED")
		assert.equal(restoredMachine.isTurnComplete, true, "Restored turn should be complete")
		assert.equal(restoredMachine.shouldSkip(functionIds[1]), true, "Restored: shouldSkip should work on SKIPPED block")
	})
})

// ── toolNameToAskType — conversational tools ──

describe("BlockPhaseMachine.toolNameToAskType — conversational tools", () => {
	const CONVERSATIONAL_TOOLS = [
		"qna_respond",
		"plan_mode_respond",
		"act_mode_respond",
		"ask_followup_question",
		"generate_report",
	] as const

	for (const toolName of CONVERSATIONAL_TOOLS) {
		it(`RED: toolNameToAskType("${toolName}") returns "tool" instead of "${toolName}"`, () => {
			const askType = BlockPhaseMachine.toolNameToAskType(toolName)
			// Currently returns "tool" (default case) — this is the BUG.
			// After fix, it should return the tool name itself as the ask type.
			expect(askType).toBe(toolName)
		})
	}

	it("non-conversational tool still returns expected ask types", () => {
		expect(BlockPhaseMachine.toolNameToAskType("execute_command")).toBe("command")
		expect(BlockPhaseMachine.toolNameToAskType("write_to_file")).toBe("tool")
		expect(BlockPhaseMachine.toolNameToAskType("browser_action")).toBe("browser_action_launch")
		expect(BlockPhaseMachine.toolNameToAskType("use_mcp_tool")).toBe("use_mcp_server")
	})
})
