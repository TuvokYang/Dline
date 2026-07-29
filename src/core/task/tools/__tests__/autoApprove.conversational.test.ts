import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { AutoApprove } from "../autoApprove"

/** Conversational / TURN-END tools that must be auto-approved so their
 *  handler.execute() → interactions.open() flow fires through
 *  BLOCK_EXECUTION_STARTED → EXECUTE_TOOL. */
const CONVERSATIONAL_TOOLS = [
	ClineDefaultTool.ATTEMPT,
	ClineDefaultTool.QNA_RESPOND,
	ClineDefaultTool.MAKE_PLAN,
	ClineDefaultTool.ACT_MODE,
	ClineDefaultTool.ASK,
	ClineDefaultTool.GENERATE_REPORT,
] as const

function createStateManager(overrides: Record<string, unknown> = {}): StateManager {
	return {
		getGlobalSettingsKey: vi.fn((key: string) => {
			if (key in overrides) return overrides[key]
			// Default: no auto-approve settings, no yolo mode
			return undefined
		}),
	} as unknown as StateManager
}

describe("AutoApprove — conversational tools must be auto-approved", () => {
	it("RED: shouldAutoApproveTool returns false for conversational tools without explicit settings", () => {
		const autoApprove = new AutoApprove(createStateManager())

		for (const tool of CONVERSATIONAL_TOOLS) {
			const result = autoApprove.shouldAutoApproveTool(tool)
			// Currently returns false — this is the BUG.
			// After fix, it should return true.
			expect(result).toBe(true)
		}
	})

	it("conversational tools are NOT listed in any auto-approve switch case (documenting current gap)", () => {
		// Even with yolo mode on, conversational tools are not in the switch
		const autoApprove = new AutoApprove(createStateManager({ yoloModeToggled: true }))

		for (const tool of CONVERSATIONAL_TOOLS) {
			const result = autoApprove.shouldAutoApproveTool(tool)
			expect(result).toBe(true)
		}
	})

	it("conversational tools are NOT listed in autoApproveAll switch case", () => {
		const autoApprove = new AutoApprove(createStateManager({ autoApproveAllToggled: true }))

		for (const tool of CONVERSATIONAL_TOOLS) {
			const result = autoApprove.shouldAutoApproveTool(tool)
			expect(result).toBe(true)
		}
	})

	it("routes status updates through the handler that owns acknowledgment", () => {
		const autoApprove = new AutoApprove(createStateManager())

		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.STATUS_UPDATE)).toBe(true)
	})
})
