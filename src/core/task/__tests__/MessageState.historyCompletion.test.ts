import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { isTaskHistoryCompleted } from "../history-completion"

describe("task history completion metadata", () => {
	it("marks history complete when the last conversation is attempt_completion", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "Complete this task" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "Done" },
			{ ts: 3, type: "say", say: "checkpoint_created" },
			{ ts: 4, type: "say", say: "api_req_finished", text: "{}" },
			{ ts: 5, type: "say", say: "reasoning", text: "Persisted trailing reasoning" },
		]

		expect(isTaskHistoryCompleted(messages)).toBe(true)
	})

	it("clears the completed state after post-completion feedback continues the conversation", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "Complete this task" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "Done" },
			{ ts: 3, type: "say", say: "user_feedback", text: "Please adjust one detail" },
		]

		expect(isTaskHistoryCompleted(messages)).toBe(false)
	})
})
