import type { ClineStorageMessage } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { indexLogicalTurns } from "../logical-turns"
import { planNextCompactionPass } from "../compaction-pass-planner"
import { startTargetWindowFitting } from "../target-window-fitting"

function message(role: "user" | "assistant", text: string): ClineStorageMessage {
	return { role, content: [{ type: "text", text }] }
}

function createHistory(): ClineStorageMessage[] {
	return [
		message("user", "<task>Turn A</task>"),
		message("assistant", "Response A"),
		message("user", "<user_message>Turn B</user_message>"),
		message("assistant", "Response B"),
		message("user", "<user_message>Turn C</user_message>"),
		message("assistant", "Response C"),
	]
}

function estimateByTurnMarkers(messages: readonly ClineStorageMessage[]): number {
	const text = JSON.stringify(messages)
	return 100 + ["Turn A", "Turn B", "Turn C"].filter((marker) => text.includes(marker)).length * 100
}

describe("compaction Pass planner", () => {
	it("packs every consecutive complete turn that fits before the first overflowing turn", async () => {
		const state = startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-maximal-batch")

		const result = await planNextCompactionPass({
			state,
			passInputCeiling: 350,
			estimateInputTokens: estimateByTurnMarkers,
		})

		expect(result).toMatchObject({
			kind: "planned",
			plan: {
				passStartTurnIndex: 0,
				passEndTurnIndex: 1,
				passStartMessageIndex: 0,
				passEndMessageIndex: 3,
				estimatedInputTokens: 300,
				passInputCeiling: 350,
			},
		})
		if (result.kind !== "planned") throw new Error("Expected a planned compaction Pass")
		expect(result.plan.sourceHistoryHash).toMatch(/^sha256:[a-f0-9]{64}$/)
		expect(result.plan.rangeHash).toMatch(/^sha256:[a-f0-9]{64}$/)
		expect(result.plan.rangeHash).not.toBe(result.plan.sourceHistoryHash)
	})

	it("includes the cumulative summary in the next Pass estimate", async () => {
		const state = {
			...startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-summary-baseline"),
			coveredTurnCount: 1,
			passIndex: 1,
			cumulativeSummary: "SUMMARY_BASELINE",
		}
		const estimatedInputs: string[] = []

		const result = await planNextCompactionPass({
			state,
			passInputCeiling: 260,
			estimateInputTokens: (messages) => {
				const text = JSON.stringify(messages)
				estimatedInputs.push(text)
				return 100 + (text.includes("SUMMARY_BASELINE") ? 50 : 0) + (text.includes("Turn B") ? 100 : 0) + (text.includes("Turn C") ? 100 : 0)
			},
		})

		expect(result).toMatchObject({
			kind: "planned",
			plan: { passStartTurnIndex: 1, passEndTurnIndex: 1, estimatedInputTokens: 250 },
		})
		expect(estimatedInputs.every((input) => input.includes("SUMMARY_BASELINE"))).toBe(true)
	})

	it("reports the earliest uncovered turn when one complete turn cannot fit", async () => {
		const state = startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-too-large-turn")

		const result = await planNextCompactionPass({
			state,
			passInputCeiling: 199,
			estimateInputTokens: estimateByTurnMarkers,
		})

		expect(result).toEqual({
			kind: "needs_smaller_input",
			turnIndex: 0,
			estimatedInputTokens: 200,
			passInputCeiling: 199,
		})
	})
})
