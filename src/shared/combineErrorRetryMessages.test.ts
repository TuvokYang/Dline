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

const activeRetry = (): ClineMessage => ({
	type: "say",
	say: "error_retry",
	text: JSON.stringify({ attempt: 1, maxAttempts: 3, errorMessage: "Provider failed" }),
	ts: 1,
	conversationHistoryIndex: 0,
})

describe("combineErrorRetryMessages", () => {
	it("keeps an active error while the retry has started but no provider response arrived", () => {
		const messages: ClineMessage[] = [
			activeRetry(),
			{ type: "say", say: "api_req_retried", ts: 2, conversationHistoryIndex: 0 },
		]

		expect(combineErrorRetryMessages(messages)).toContainEqual(messages[0])
	})

	it("retires an active error when same-turn partial reasoning proves the retry stream recovered", () => {
		const messages: ClineMessage[] = [
			activeRetry(),
			{ type: "say", say: "api_req_retried", ts: 2, conversationHistoryIndex: 0 },
			{
				type: "say",
				say: "reasoning",
				text: "Recovered response chunk",
				partial: true,
				ts: 3,
				conversationHistoryIndex: 0,
			},
		]

		expect(combineErrorRetryMessages(messages)).not.toContainEqual(messages[0])
	})

	it("retires an active error when a same-turn partial tool presentation proves recovery", () => {
		const messages: ClineMessage[] = [
			activeRetry(),
			{ type: "say", say: "api_req_retried", ts: 2, conversationHistoryIndex: 0 },
			{
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile", path: "README.md" }),
				partial: true,
				ts: 3,
				conversationHistoryIndex: 0,
			},
		]

		expect(combineErrorRetryMessages(messages)).not.toContainEqual(messages[0])
	})

	it("does not treat same-turn local bookkeeping as a recovered provider stream", () => {
		const messages: ClineMessage[] = [
			activeRetry(),
			{ type: "say", say: "api_req_retried", ts: 2, conversationHistoryIndex: 0 },
			{ type: "say", say: "checkpoint_created", ts: 3, conversationHistoryIndex: 0 },
		]

		expect(combineErrorRetryMessages(messages)).toContainEqual(messages[0])
	})

	it("retires automatic retry status when the canonical API recovery ask is shown", () => {
		const messages: ClineMessage[] = [
			activeRetry(),
			{
				type: "ask",
				ask: "api_req_failed",
				text: "Provider failed",
				ts: 2,
				conversationHistoryIndex: 0,
			},
		]

		expect(combineErrorRetryMessages(messages)).toEqual([messages[1]])
	})

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
