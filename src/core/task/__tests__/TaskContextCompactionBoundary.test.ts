import type { ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages"
import type { ClineContent } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { Task } from "../index"

interface BoundaryTaskHarness {
	taskState: {
		userMessageContent: ClineContent[]
		conversationHistoryDeletedRange?: [number, number]
	}
	contextManager: {
		getTruncatedMessages(history: ClineStorageMessage[], deletedRange?: [number, number]): ClineStorageMessage[]
	}
	messageStateHandler: {
		apiConversationHistory: ClineStorageMessage[]
	}
	getOrdinaryContextCompactionBoundary(): {
		sourceHistory: ClineStorageMessage[]
		targetContinuationHistory: ClineStorageMessage[]
	}
}

function createHarness(): BoundaryTaskHarness {
	const history: ClineStorageMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: "first turn" }],
			ts: 1,
		},
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					name: "qna_respond",
					input: { response: "question" },
					dline_tid: "tid-qna",
					function_id: "fn-qna",
				},
			],
			ts: 2,
		},
	]
	const harness = Object.assign(Object.create(Task.prototype), {
		taskState: {
			userMessageContent: [],
			conversationHistoryDeletedRange: undefined,
		},
		contextManager: {
			getTruncatedMessages: (input: ClineStorageMessage[]) => input,
		},
		messageStateHandler: { apiConversationHistory: history },
	}) as BoundaryTaskHarness
	return harness
}

function pendingToolResult(text = "<feedback>\nuser reply\n</feedback>"): ClineUserToolResultContentBlock {
	return {
		type: "tool_result",
		content: [
			{
				type: "text",
				text,
			},
		],
		dline_tid: "tid-qna",
		function_id: "fn-qna",
	}
}

describe("Task ordinary context compaction boundary", () => {
	it("keeps pending qna feedback outside the compaction source while releasing the protected tail", () => {
		const task = createHarness()
		task.taskState.userMessageContent = [pendingToolResult()]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		expect(boundary.targetContinuationHistory).toEqual([])
		expect(boundary.sourceHistory.length).toBe(2)
		expect(boundary.sourceHistory[1]?.role).toBe("assistant")
		expect(JSON.stringify(boundary.sourceHistory)).not.toContain("user reply")
	})

	it("never duplicates pending tool results into the continuation tail", () => {
		const task = createHarness()
		task.taskState.userMessageContent = [pendingToolResult()]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		const tailResults = boundary.targetContinuationHistory.flatMap((message) =>
			message.role === "user" && Array.isArray(message.content)
				? message.content.filter((block): block is ClineUserToolResultContentBlock => block.type === "tool_result")
				: [],
		)
		expect(tailResults).toEqual([])
	})

	it("keeps the pre-existing tail intact when there are no pending tool results", () => {
		const task = createHarness()
		// Persist the qna tool result canonically, then append an unpaired assistant
		// tool use that legitimately protects the tail.
		task.messageStateHandler.apiConversationHistory.push({
			role: "user",
			content: [pendingToolResult()],
			ts: 3,
		})
		task.messageStateHandler.apiConversationHistory.push({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					name: "attempt_completion",
					input: { result: "done" },
					dline_tid: "tid-attempt",
					function_id: "fn-attempt",
				},
			],
			ts: 4,
		})

		const boundary = task.getOrdinaryContextCompactionBoundary()

		// The latest tagged feedback and its assistant response remain one protected tail.
		expect(boundary.sourceHistory.length).toBe(2)
		expect(boundary.targetContinuationHistory.length).toBe(2)
		expect(boundary.targetContinuationHistory[0]?.role).toBe("user")
		expect(boundary.targetContinuationHistory[1]?.role).toBe("assistant")
	})

	it("keeps pending turn-end feedback outside the compaction source", () => {
		const task = createHarness()
		// Close the qna turn canonically first so only the attempt turn is open.
		task.messageStateHandler.apiConversationHistory.push({
			role: "user",
			content: [pendingToolResult()],
			ts: 3,
		})
		task.messageStateHandler.apiConversationHistory.push({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					name: "attempt_completion",
					input: { result: "done" },
					dline_tid: "tid-attempt",
					function_id: "fn-attempt",
				},
			],
			ts: 4,
		})
		const attemptResult: ClineUserToolResultContentBlock = {
			type: "tool_result",
			content: [
				{
					type: "text",
					text: "The user provided the following feedback:\n<feedback>\nplease continue\n</feedback>",
				},
			],
			dline_tid: "tid-attempt",
			function_id: "fn-attempt",
		}
		task.taskState.userMessageContent = [attemptResult]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		expect(boundary.targetContinuationHistory).toEqual([])
		expect(boundary.sourceHistory.length).toBe(4)
		expect(boundary.sourceHistory[3]?.role).toBe("assistant")
		expect(JSON.stringify(boundary.sourceHistory)).not.toContain("please continue")
	})

	it("pairs pending results for multiple different tools in one view", () => {
		const task = createHarness()
		// Canonical history: user → assistant with TWO tool uses (qna + read_file).
		task.messageStateHandler.apiConversationHistory[1] = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					name: "qna_respond",
					input: { response: "question" },
					dline_tid: "tid-qna",
					function_id: "fn-qna",
				},
				{
					type: "tool_use",
					name: "read_file",
					input: { path: "a.txt" },
					dline_tid: "tid-read",
					function_id: "fn-read",
				},
			],
			ts: 2,
		}
		const readResult: ClineUserToolResultContentBlock = {
			type: "tool_result",
			content: [{ type: "text", text: "file contents" }],
			dline_tid: "tid-read",
			function_id: "fn-read",
		}
		task.taskState.userMessageContent = [pendingToolResult("plain qna result"), readResult]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		expect(boundary.targetContinuationHistory).toEqual([])
		expect(boundary.sourceHistory.length).toBe(3)
		const lastSourceMessage = boundary.sourceHistory[boundary.sourceHistory.length - 1]
		const results = (lastSourceMessage?.content as ClineContent[]).filter(
			(block): block is ClineUserToolResultContentBlock => block.type === "tool_result",
		)
		expect(results.map((result) => result.function_id)).toEqual(["fn-qna", "fn-read"])
	})

	it("excludes transient tool_feedback blocks from the pairing view", () => {
		const task = createHarness()
		const transientFeedback = {
			type: "tool_feedback",
			content: { type: "text", text: "transient" },
		}
		task.taskState.userMessageContent = [transientFeedback as unknown as ClineContent]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		// Without a pairing tool_result the pending qna tool_use keeps the whole
		// turn protected, and tool_feedback must not leak into the boundary view.
		expect(boundary.sourceHistory).toEqual([])
		expect(boundary.targetContinuationHistory.length).toBe(2)
		expect(boundary.targetContinuationHistory[0]?.role).toBe("user")
		expect(boundary.targetContinuationHistory[1]?.role).toBe("assistant")
	})

	it("treats pending tagged text as the start of the next round instead of pairing it", () => {
		const task = createHarness()
		// qna turn is canonically complete: user → assistant tool_use → user result.
		task.messageStateHandler.apiConversationHistory.push({
			role: "user",
			content: [pendingToolResult()],
			ts: 3,
		})
		const pendingText = { type: "text", text: "<feedback>\nnew user instruction\n</feedback>" }
		task.taskState.userMessageContent = [pendingText as unknown as ClineContent]

		const boundary = task.getOrdinaryContextCompactionBoundary()

		// The canonical qna turn is fully summarizable source; the pending text is
		// the upcoming round's own content and must not appear in the tail.
		expect(boundary.sourceHistory.length).toBe(3)
		expect(boundary.targetContinuationHistory).toEqual([])
	})
})
