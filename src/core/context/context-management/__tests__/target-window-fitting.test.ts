import type { ClineStorageMessage } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { indexLogicalTurns } from "../logical-turns"
import {
	acceptCompactionPass,
	applyCompactionPassPlan,
	buildCompactionPassHistory,
	buildTargetCandidateHistory,
	startTargetWindowFitting,
	type TargetWindowFittingState,
	tryStartTargetWindowFitting,
} from "../target-window-fitting"

function message(role: "user" | "assistant", text: string): ClineStorageMessage {
	return { role, content: [{ type: "text", text }] }
}

function qnaAssistant(functionId: string, marker: string): ClineStorageMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: marker },
			{
				type: "tool_use",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				name: "qna_respond",
				input: { response: marker },
			},
		],
	}
}

function qnaFeedback(functionId: string, text: string): ClineStorageMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				content: `[qna_respond] Result:\n<feedback>${text}</feedback>`,
			},
		],
	}
}

function serialized(messages: readonly ClineStorageMessage[]): string {
	return JSON.stringify(messages)
}

function createHistory(): ClineStorageMessage[] {
	return [
		{
			role: "user",
			content: [
				{ type: "text", text: "<task>E2E_ROLLING_TASK</task>" },
				{ type: "text", text: "<environment_details>stale turn A environment</environment_details>" },
			],
		},
		qnaAssistant("call-a", "E2E_ROLLING_TURN_A"),
		qnaFeedback("call-a", "E2E_ROLLING_USER_TURN_B"),
		qnaAssistant("call-b", "E2E_ROLLING_TURN_B"),
		qnaFeedback("call-b", "E2E_ROLLING_USER_TURN_C"),
	]
}

function planThrough(state: TargetWindowFittingState, passEndTurnIndex: number): TargetWindowFittingState {
	return applyCompactionPassPlan(state, {
		operationId: state.operationId,
		passIndex: state.passIndex,
		passStartTurnIndex: state.coveredTurnCount,
		passEndTurnIndex,
		coveredTurnCount: state.coveredTurnCount,
		summaryBaselineHash: state.summaryBaselineHash,
		estimatedInputTokens: 100 + (passEndTurnIndex - state.coveredTurnCount + 1) * 100,
		passInputCeiling: 1_000,
		passHistoryHash: `sha256:pass-${state.passIndex}-${state.coveredTurnCount}-${passEndTurnIndex}`,
	})
}

describe("target window rolling fitting", () => {
	it("requires an explicit Pass plan and builds the selected maximal range", () => {
		const unplanned = startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-rolling")
		expect(() => buildCompactionPassHistory(unplanned)).toThrow(
			"Compaction Pass must be planned before building its history",
		)

		const state = planThrough(unplanned, 1)
		const pass = serialized(buildCompactionPassHistory(state))

		expect(state).toMatchObject({
			operationId: "operation-rolling",
			passIndex: 0,
			passStartTurnIndex: 0,
			passEndTurnIndex: 1,
			coveredTurnCount: 0,
			passPlanned: true,
		})
		expect(state.summaryBaselineHash).toMatch(/^sha256:/)
		expect(pass).toContain("E2E_ROLLING_TURN_A")
		expect(pass).toContain("E2E_ROLLING_TURN_B")
		expect(pass).not.toContain("stale turn A environment")
		expect(pass).not.toContain("<environment_details>")
	})

	it("rolls the previous cumulative summary into the next planned uncovered range", () => {
		const initial = startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-rolling")
		const firstPass = planThrough(initial, 0)
		const afterFirst = acceptCompactionPass(firstPass, "E2E_ROLLING_SUMMARY_ONE").state
		const secondPlanned = planThrough(afterFirst, 1)
		const secondPass = serialized(buildCompactionPassHistory(secondPlanned))

		expect(afterFirst).toMatchObject({
			operationId: "operation-rolling",
			passIndex: 1,
			coveredTurnCount: 1,
			passPlanned: false,
		})
		expect(secondPlanned).toMatchObject({ passStartTurnIndex: 1, passEndTurnIndex: 1, passPlanned: true })
		expect(afterFirst.summaryBaselineHash).not.toBe(initial.summaryBaselineHash)
		expect(secondPass).toContain("E2E_ROLLING_SUMMARY_ONE")
		expect(secondPass).toContain("E2E_ROLLING_TURN_B")
		expect(secondPass).not.toContain("E2E_ROLLING_TURN_A")
	})

	it("builds the ordinary target candidate from the cumulative summary, remaining turns, protected tail and dynamic continuation", () => {
		const initial = startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-target")
		const afterFirst = acceptCompactionPass(planThrough(initial, 0), "E2E_ROLLING_SUMMARY_ONE").state
		const afterSecond = acceptCompactionPass(planThrough(afterFirst, 1), "E2E_ROLLING_SUMMARY_TWO").state
		const continuation = [
			qnaAssistant("call-protected", "E2E_ROLLING_PROTECTED_TURN_C"),
			message(
				"user",
				"<user_message>E2E_ROLLING_CONTINUATION</user_message>\n<environment_details>dynamic only</environment_details>",
			),
		]
		const target = serialized(buildTargetCandidateHistory(afterSecond, continuation))

		expect(target).toContain("E2E_ROLLING_SUMMARY_TWO")
		expect(target).toContain("E2E_ROLLING_PROTECTED_TURN_C")
		expect(target).toContain("E2E_ROLLING_CONTINUATION")
		expect(target).toContain("<environment_details>")
		expect(target).not.toContain("stale turn A environment")
		expect(target).not.toContain("E2E_ROLLING_SUMMARY_ONE")
		expect(target).not.toContain("E2E_ROLLING_TURN_A")
		expect(target).not.toContain("E2E_ROLLING_TURN_B")
	})

	it("keeps one-shot compaction when no complete logical turn is available", () => {
		const index = indexLogicalTurns([message("user", "<user_message>pending</user_message>")])

		expect(tryStartTargetWindowFitting(index, "operation-one-shot")).toBeUndefined()
		expect(() => startTargetWindowFitting(index, "operation-one-shot")).toThrow(
			"No complete logical turn is available for compaction",
		)
	})

	it("starts rolling fitting when at least one complete logical turn is available", () => {
		const state = tryStartTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-rolling")

		expect(state).toMatchObject({ operationId: "operation-rolling", coveredTurnCount: 0, passIndex: 0 })
	})

	it("rejects an empty summary without advancing coverage", () => {
		const state = planThrough(
			startTargetWindowFitting(indexLogicalTurns(createHistory()), "operation-empty-summary"),
			0,
		)

		expect(() => acceptCompactionPass(state, "  ")).toThrow("Compaction summary must be non-empty")
		expect(state.coveredTurnCount).toBe(0)
	})
})
