import { describe, expect, it } from "vitest"
import { combineErrorRetryMessages } from "./combineErrorRetryMessages"
import type { ClineMessage } from "./ExtensionMessage"

const exhaustedRetry = (): ClineMessage => ({
	type: "say",
	say: "error_retry",
	text: JSON.stringify({ attempt: 3, maxAttempts: 3, failed: true, errorMessage: "Provider failed" }),
	ts: 1,
	conversationHistoryIndex: 4,
})

describe("combineErrorRetryMessages", () => {
	it("keeps an exhausted error while a manual retry has not produced a durable response", () => {
		const messages: ClineMessage[] = [
			exhaustedRetry(),
			{ type: "say", say: "api_req_started", text: "{}", ts: 2, conversationHistoryIndex: 4 },
		]

		expect(combineErrorRetryMessages(messages)).toContainEqual(messages[0])
	})

	it("retires an exhausted error after the manual retry produces a durable response", () => {
		const messages: ClineMessage[] = [
			exhaustedRetry(),
			{ type: "say", say: "api_req_started", text: "{}", ts: 2, conversationHistoryIndex: 4 },
			{ type: "say", say: "completion_result", text: "Recovered", ts: 3, conversationHistoryIndex: 5 },
		]

		expect(combineErrorRetryMessages(messages)).not.toContainEqual(messages[0])
	})
})
