import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { findInteractionMessage, findSnapshotAnchoredMessage, groupLowStakesTools, isToolGroup } from "./messageUtils"

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
})

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
})

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
})

describe("groupLowStakesTools", () => {
	it("ignores text that arrives after a low-stakes tool group has started", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Late text that should be ignored"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)

		if (isToolGroup(grouped[1])) {
			expect(grouped[1].every((message) => message.say !== "text")).toBe(true)
		}
	})

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Follow-up text" })
	})

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "text", text: "Answer text" })
	})

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
	})

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([createReasoningMessage(1, "Planning next read"), createToolMessage(2, "readFile")])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Planning next read" })
		expect(isToolGroup(grouped[1])).toBe(true)
	})
})

describe("snapshot anchored interaction message", () => {
	it("uses the latest state_snapshot apiIndex instead of the raw last message", () => {
		const qnaAsk: ClineMessage = {
			ts: 1782966437140,
			type: "ask",
			ask: "qna_respond",
			text: JSON.stringify({ response: "ok" }),
			partial: false,
			conversationHistoryIndex: 3,
		}
		const snapshot: ClineMessage = {
			ts: 1782969236658,
			type: "say",
			say: "state_snapshot",
			text: JSON.stringify({ phase: "streaming", apiIndex: 3, timestamp: 1782969236657 }),
			conversationHistoryIndex: 3,
		}
		const messages: ClineMessage[] = [
			{
				ts: 1782966431702,
				type: "say",
				say: "api_req_started",
				text: "{}",
				conversationHistoryIndex: 1,
			},
			qnaAsk,
			snapshot,
		]

		expect(findSnapshotAnchoredMessage(messages)).toBe(qnaAsk)
		expect(findInteractionMessage(messages)).toBe(qnaAsk)
	})

	it("uses approval block metadata to choose the matching ask type", () => {
		const commandAsk: ClineMessage = {
			ts: 200,
			type: "ask",
			ask: "command",
			text: "npm test",
			conversationHistoryIndex: 4,
		}
		const toolAsk: ClineMessage = {
			ts: 201,
			type: "ask",
			ask: "tool",
			text: "{}",
			conversationHistoryIndex: 4,
		}
		const snapshot: ClineMessage = {
			ts: 300,
			type: "say",
			say: "state_snapshot",
			text: JSON.stringify({
				phase: "awaiting_approval",
				apiIndex: 4,
				timestamp: 300,
				approval: {
					activeCallId: "call_command",
					blocks: [
						{
							callId: "call_command",
							name: "execute_command",
							phase: "awaiting_approval",
							apiIndex: 4,
						},
					],
				},
			}),
			conversationHistoryIndex: 4,
		}

		expect(findSnapshotAnchoredMessage([commandAsk, toolAsk, snapshot])).toBe(commandAsk)
	})

	it("prefers a newer trailing approval ask over a stale streaming snapshot", () => {
		const qnaAsk: ClineMessage = {
			ts: 1782969907777,
			type: "ask",
			ask: "qna_respond",
			text: "{}",
			conversationHistoryIndex: 3,
		}
		const staleSnapshot: ClineMessage = {
			ts: 1782972083079,
			type: "say",
			say: "state_snapshot",
			text: JSON.stringify({ phase: "streaming", apiIndex: 3, timestamp: 1782972083079 }),
			conversationHistoryIndex: 3,
		}
		const toolAsk: ClineMessage = {
			ts: 1782972107524,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "listFilesTopLevel", path: "e:/workspace/vscode/dline" }),
			partial: false,
			conversationHistoryIndex: 5,
		}

		expect(findSnapshotAnchoredMessage([staleSnapshot, qnaAsk, toolAsk])).toBe(qnaAsk)
		expect(findInteractionMessage([staleSnapshot, qnaAsk, toolAsk])).toBe(toolAsk)
	})

	it("replays messages after an awaiting snapshot so consumed turn-ending asks do not remain active", () => {
		const qnaAsk: ClineMessage = {
			ts: 100,
			type: "ask",
			ask: "qna_respond",
			text: JSON.stringify({ response: "Need clarification" }),
			partial: false,
			conversationHistoryIndex: 3,
		}
		const awaitingSnapshot: ClineMessage = {
			ts: 110,
			type: "say",
			say: "state_snapshot",
			text: JSON.stringify({
				phase: "awaiting_approval",
				apiIndex: 3,
				timestamp: 110,
				awaiting: {
					kind: "conversation",
					taskAsk: "qna_respond",
					messageTs: 100,
				},
			}),
			conversationHistoryIndex: 3,
		}
		const userFeedback: ClineMessage = {
			ts: 120,
			type: "say",
			say: "user_feedback",
			text: "Here is the clarification.",
			conversationHistoryIndex: 3,
		}
		const nextRequest: ClineMessage = {
			ts: 130,
			type: "say",
			say: "api_req_started",
			text: "{}",
			conversationHistoryIndex: 4,
		}

		const messages = [qnaAsk, awaitingSnapshot, userFeedback, nextRequest]

		expect(findSnapshotAnchoredMessage(messages)).toBeUndefined()
		expect(findInteractionMessage(messages)).toBe(nextRequest)
	})
})
