import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import type { MessageChannel } from "../MessageChannel"
import { TaskController } from "../TaskController"

const mockChannel: MessageChannel = {
	say: vi.fn(),
	ask: vi.fn(),
	resolve: vi.fn(),
} as unknown as MessageChannel

/** Build the stable Dline trace identity used by lifecycle operations. */
function traceId(functionId: string): string {
	return `dline_tid_${functionId}`
}

/** Create a canonical runtime tool block with separate provider and Dline identities. */
function createToolBlock(name: string, functionId: string, ts: number) {
	return {
		type: "tool_use" as const,
		name,
		item_id: `dline_item_${functionId}`,
		function_id: functionId,
		call_id: functionId,
		dline_tid: traceId(functionId),
		ts,
	}
}

describe("TaskController", () => {
	let controller: TaskController

	beforeEach(() => {
		controller = new TaskController(mockChannel)
	})

	// ==========================================================================
	// Turn Building
	// ==========================================================================

	describe("buildTurn", () => {
		it("creates turn blocks with correct lifecycle", () => {
			const blocks = [
				createToolBlock("execute_command", "ec1", 100),
				createToolBlock("read_file", "rf1", 200),
				createToolBlock("write_to_file", "wf1", 300),
			]

			controller.buildTurn(blocks, (_toolName, _callId) => false) // none auto-approved

			const active = controller.getActiveBlock()
			assert.equal(active, null) // no block is AWAITING_APPROVAL yet — advance() must be called
		})

		it("auto-approve predicate affects requiresApproval", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, (toolName) => toolName === "read_file")
			// Block should be auto-approved, advance should return auto-execute
			const event = controller.advance(traceId("rf1"), true)
			assert.equal(event.type, "auto-execute")
		})
	})

	// ==========================================================================
	// Approval Token
	// ==========================================================================

	describe("approval token", () => {
		it("acquireToken grants to first approval-requiring block", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100), createToolBlock("write_to_file", "wf1", 200)]

			controller.buildTurn(blocks, () => false) // none auto-approved

			const token1 = controller.blockPhase.acquireToken(traceId("ec1"))
			assert.equal(token1.granted, true)
			assert.equal(token1.mustWait, false)
		})

		it("acquireToken makes second approval block wait", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100), createToolBlock("write_to_file", "wf1", 200)]

			controller.buildTurn(blocks, () => false)

			controller.blockPhase.acquireToken(traceId("ec1"))
			const token2 = controller.blockPhase.acquireToken(traceId("wf1"))
			assert.equal(token2.granted, false)
			assert.equal(token2.mustWait, true)
		})

		it("releaseToken advances to next approval block", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100), createToolBlock("write_to_file", "wf1", 200)]

			controller.buildTurn(blocks, () => false)
			// advance ec1 so it enters AWAITING_APPROVAL and holds the token
			controller.advance(traceId("ec1"), true) // → AWAITING_APPROVAL, also acquires token
			controller.completeActiveBlock() // → EXECUTING

			// releaseToken should skip ec1 (now EXECUTING) and return wf1
			const next = controller.blockPhase.releaseToken()
			assert.notEqual(next, null)
			assert.equal(next?.functionId, "wf1")
		})

		it("auto-approve blocks always return granted", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true) // all auto-approved
			const token = controller.blockPhase.acquireToken(traceId("rf1"))
			assert.equal(token.granted, true)
			assert.equal(token.mustWait, false)
		})
	})

	// ==========================================================================
	// Phase State Machine
	// ==========================================================================

	describe("advance (phase state machine)", () => {
		it("STREAMING → AUTO_EXECUTING for auto-approve when ready", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true)
			const event = controller.advance(traceId("rf1"), true)
			assert.equal(event.type, "auto-execute")
		})

		it("STREAMING → noop when not ready", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true)
			const event = controller.advance(traceId("rf1"), false)
			assert.equal(event.type, "noop")
		})

		it("STREAMING → AWAITING_APPROVAL for approval-requiring block", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100)]

			controller.buildTurn(blocks, () => false)
			const event = controller.advance(traceId("ec1"), true)
			assert.equal(event.type, "awaiting-approval")

			const active = controller.getActiveBlock()
			assert.notEqual(active, null)
			assert.equal(active?.functionId, "ec1")
		})

		it("AUTO_EXECUTING → COMPLETED on second advance", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true)
			controller.advance(traceId("rf1"), true) // → AUTO_EXECUTING
			const event = controller.advance(traceId("rf1"), true) // → COMPLETED
			assert.equal(event.type, "completed")
		})

		it("EXECUTING → COMPLETED on second advance", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100)]

			controller.buildTurn(blocks, () => false)
			controller.advance(traceId("ec1"), true) // → AWAITING_APPROVAL
			controller.completeActiveBlock() // → EXECUTING
			const event = controller.advance(traceId("ec1"), true) // → COMPLETED
			assert.equal(event.type, "completed")
		})
	})

	// ==========================================================================
	// Reject + Cascade Skip
	// ==========================================================================

	describe("rejectActiveBlock + cascadeSkip", () => {
		it("reject cascades SKIPPED to subsequent approval blocks", () => {
			const blocks = [
				createToolBlock("execute_command", "ec1", 100),
				createToolBlock("write_to_file", "wf1", 200),
				createToolBlock("read_file", "rf1", 300),
			]

			controller.buildTurn(blocks, (toolName) => toolName === "read_file") // rf1 auto-approved

			// ec1 acquires token and awaits approval
			controller.advance(traceId("ec1"), true) // → AWAITING_APPROVAL

			const rejected = controller.rejectActiveBlock()
			assert.notEqual(rejected, null)
			assert.equal(rejected?.functionId, "ec1")

			// wf1 should be SKIPPED (approval-requiring, after rejected)
			assert.equal(controller.shouldSkip(traceId("wf1")), true)
			// rf1 should NOT be skipped (auto-approved)
			assert.equal(controller.shouldSkip(traceId("rf1")), false)
		})

		it("hasAnyRejection returns true after reject", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100)]

			controller.buildTurn(blocks, () => false)
			controller.advance(traceId("ec1"), true) // → AWAITING_APPROVAL
			controller.rejectActiveBlock()

			assert.equal(controller.hasAnyRejection(), true)
		})

		it("hasAnyRejection returns false by default", () => {
			assert.equal(controller.hasAnyRejection(), false)
		})
	})

	// ==========================================================================
	// Turn Completion
	// ==========================================================================

	describe("isTurnComplete", () => {
		it("returns false when blocks still pending", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100)]

			controller.buildTurn(blocks, () => false)
			assert.equal(controller.isTurnComplete, false)
		})

		it("returns true when all blocks in terminal phase", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true)
			controller.advance(traceId("rf1"), true) // → AUTO_EXECUTING
			controller.advance(traceId("rf1"), true) // → COMPLETED
			assert.equal(controller.isTurnComplete, true)
		})
	})

	// ==========================================================================
	// Reset
	// ==========================================================================

	describe("reset", () => {
		it("clears all turn and pipeline state", () => {
			const blocks = [createToolBlock("read_file", "rf1", 100)]

			controller.buildTurn(blocks, () => true)
			controller.reset()

			assert.equal(controller.getActiveBlock(), null)
			assert.equal(controller.hasAnyRejection(), false)
		})
	})

	// ==========================================================================
	// isTerminalPhase (via releaseToken behavior)
	// ==========================================================================

	describe("releaseToken skips terminal phases", () => {
		it("skips blocks already in AWAITING_APPROVAL phase", () => {
			const blocks = [createToolBlock("execute_command", "ec1", 100), createToolBlock("write_to_file", "wf1", 200)]

			controller.buildTurn(blocks, () => false)

			// Simulate: first block gets the token
			const token1 = controller.blockPhase.acquireToken(traceId("ec1"))
			assert.equal(token1.granted, true)

			// Advance ec1 from STREAMING to AWAITING_APPROVAL (simulating what advance() does)
			controller.blockPhase.acquireToken(traceId("ec1"))
			// Manually mark ec1 as EXECUTING to make it terminal
			controller.completeActiveBlock()

			// Now releaseToken should skip ec1 (EXECUTING = terminal) and pick wf1
			const next = controller.blockPhase.releaseToken()
			assert.notEqual(next, null)
			assert.equal(next?.functionId, "wf1")
		})
	})
})
