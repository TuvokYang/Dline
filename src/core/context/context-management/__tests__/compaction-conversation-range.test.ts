import { describe, expect, it } from "vitest"
import { createCompactionConversationRange } from "../compaction-conversation-range"
import type { TargetWindowFittingState } from "../target-window-fitting"

describe("createCompactionConversationRange", () => {
	it("aggregates canonical messages and superseded card ranges across covered turns", () => {
		const state = {
			operationId: "operation-1",
			passIndex: 2,
			passStartTurnIndex: 2,
			passEndTurnIndex: 1,
			coveredTurnCount: 2,
			summaryBaselineHash: "summary",
			sourceHistory: [
				{ role: "user", content: "old summary" },
				{ role: "user", content: "new question" },
				{ role: "assistant", content: "new answer" },
			],
			sourceCanonicalRanges: [
				[2, 5],
				[6, 6],
				[7, 7],
			],
			turns: [
				{ id: "turn-0", startIndex: 0, endIndex: 0, messages: [], functionIds: [] },
				{ id: "turn-1", startIndex: 1, endIndex: 2, messages: [], functionIds: [] },
			],
			protectedTail: [],
			cumulativeSummary: "cumulative summary",
			passPlanned: false,
		} satisfies TargetWindowFittingState

		expect(createCompactionConversationRange(state, 7)).toEqual({
			logicalTurnRange: [0, 1],
			apiConversationRange: [2, 7],
			preCompactionApiEndIndex: 7,
		})
	})
})
