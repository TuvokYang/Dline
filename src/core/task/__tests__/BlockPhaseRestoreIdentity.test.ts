import { describe, expect, it } from "vitest"
import { type BlockLifecycle, BlockPhase, BlockPhaseMachine } from "../BlockPhaseMachine"

/** Create one canonical restored block. */
function block(dlineTid: string, phase: BlockPhase): BlockLifecycle {
	return {
		dlineTid,
		functionId: `call-${dlineTid}`,
		toolName: "write_to_file",
		phase,
		ts: 1,
		requiresApproval: true,
		conversationHistoryIndex: 4,
	}
}

describe("BlockPhaseMachine strict restore identity", () => {
	it("rejects an awaiting turn without activeDlineTid", () => {
		const machine = new BlockPhaseMachine()
		expect(() => machine.restoreTurn([block("tid-active", BlockPhase.AWAITING_APPROVAL)])).toThrow(
			"Canonical awaiting turn is missing activeDlineTid",
		)
	})

	it("rejects an active identity outside the awaiting block", () => {
		const machine = new BlockPhaseMachine()
		expect(() =>
			machine.restoreTurn(
				[block("tid-active", BlockPhase.AWAITING_APPROVAL), block("tid-other", BlockPhase.STREAMING)],
				"tid-other",
			),
		).toThrow("Canonical activeDlineTid does not identify exactly one awaiting approval block")
	})

	it("rejects multiple awaiting blocks", () => {
		const machine = new BlockPhaseMachine()
		expect(() =>
			machine.restoreTurn(
				[block("tid-active", BlockPhase.AWAITING_APPROVAL), block("tid-other", BlockPhase.AWAITING_APPROVAL)],
				"tid-active",
			),
		).toThrow("Canonical activeDlineTid does not identify exactly one awaiting approval block")
	})

	it("restores exactly one canonical awaiting block", () => {
		const machine = new BlockPhaseMachine()
		machine.restoreTurn(
			[block("tid-done", BlockPhase.COMPLETED), block("tid-active", BlockPhase.AWAITING_APPROVAL)],
			"tid-active",
		)
		expect(machine.getActiveBlock()?.dlineTid).toBe("tid-active")
	})
})
