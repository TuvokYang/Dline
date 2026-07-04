import { strict as assert } from "node:assert"
import type { AssistantMessageContent, TextStreamContent, ToolUse } from "@core/assistant-message"
import { registerPartialMessageCallback } from "@core/controller/ui/subscribeToPartialMessage"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "vitest"

describe("Task.processNativeToolCalls", () => {
	it("finalizes a partial prev text block and reuses its ts for the state text block", async () => {
		const prevTextTs = 100
		const clineMessages: ClineMessage[] = [
			{
				ts: prevTextTs,
				type: "say",
				say: "text",
				text: "partial text before tool handoff",
				partial: true,
			},
		]

		const sayCalls: Array<{ text: string; partial: boolean; ts: number }> = []
		const emittedPartialMessages: Array<{ partial: boolean; text: string }> = []
		const unsubscribe = registerPartialMessageCallback((message) => {
			emittedPartialMessages.push({
				partial: message.partial,
				text: message.text,
			})
		})

		const toolBlocks: ToolUse[] = [
			{
				type: "tool_use",
				name: ClineDefaultTool.ASK,
				params: { question: "Need clarification" },
				partial: true,
				isNativeToolCall: true,
				call_id: "call-1",
				ts: Date.now(),
			},
		]

		const fakeTask = {
			genMessageTs: () => Date.now(),
			say: async (
				_type: string,
				text: string,
				_images: unknown,
				_files: unknown,
				partial: boolean,
				existingTs?: number,
			) => {
				sayCalls.push({ text, partial, ts: existingTs ?? 0 })
				return existingTs
			},
			messageStateHandler: {
				clineMessages: () => clineMessages,
				updateTaskHistory: async () => {},
				flushMessageUpdate: async (_index: number) => {},
			},
			taskState: {
				assistantMessageContent: [
					{ type: "text", content: "streamed so far", partial: true, ts: prevTextTs },
				] as AssistantMessageContent[],
				currentStreamingContentIndex: 0,
				userMessageContentReady: true,
			},
		}

		try {
			await (
				Task.prototype as unknown as { processNativeToolCalls: (text: string, blocks: ToolUse[]) => Promise<void> }
			).processNativeToolCalls.call(fakeTask, "visible streamed text", toolBlocks)

			// Should have finalized the prev partial text
			const finalizeCall = sayCalls.find((c) => c.partial === false && c.text !== "")
			assert.ok(finalizeCall, "Expected a finalize say call for the partial text")
			assert.equal(finalizeCall.ts, prevTextTs, "Finalize should reuse prev block ts")

			// The new text block in assistantMessageContent should have the same ts as prev
			const textBlock = fakeTask.taskState.assistantMessageContent.find((b) => b.type === "text") as TextStreamContent
			assert.ok(textBlock, "Expected a text block in assistantMessageContent")
			assert.equal(textBlock.ts, prevTextTs, "State text block ts should match prev block ts")
			assert.equal(textBlock.partial, false, "State text block should be finalized")
		} finally {
			unsubscribe()
		}
	})

	it("does NOT finalize a non-partial prev text block", async () => {
		const prevTextTs = 100
		const sayCalls: Array<{ text: string; partial: boolean; ts: number }> = []

		const toolBlocks: ToolUse[] = [
			{
				type: "tool_use",
				name: ClineDefaultTool.ASK,
				params: { question: "Need clarification" },
				partial: true,
				isNativeToolCall: true,
				call_id: "call-1",
				ts: Date.now(),
			},
		]

		const fakeTask = {
			genMessageTs: () => Date.now(),
			say: async (
				_type: string,
				text: string,
				_images: unknown,
				_files: unknown,
				partial: boolean,
				existingTs?: number,
			) => {
				sayCalls.push({ text, partial, ts: existingTs ?? 0 })
				return existingTs
			},
			messageStateHandler: {
				clineMessages: () => [],
				updateTaskHistory: async () => {},
				flushMessageUpdate: async (_index: number) => {},
			},
			taskState: {
				assistantMessageContent: [
					{ type: "text", content: "already finalized", partial: false, ts: prevTextTs },
				] as AssistantMessageContent[],
				currentStreamingContentIndex: 0,
				userMessageContentReady: true,
			},
		}

		await (
			Task.prototype as unknown as { processNativeToolCalls: (text: string, blocks: ToolUse[]) => Promise<void> }
		).processNativeToolCalls.call(fakeTask, "more text", toolBlocks)

		// Should NOT have a finalize say call — prev block is not partial
		const finalizeCalls = sayCalls.filter((c) => c.partial === false)
		assert.equal(finalizeCalls.length, 0, "Should not finalize a non-partial prev text block")
	})

	it("does NOT finalize when there is no prev text block", async () => {
		const sayCalls: Array<{ text: string; partial: boolean; ts: number }> = []

		const toolBlocks: ToolUse[] = [
			{
				type: "tool_use",
				name: ClineDefaultTool.ASK,
				params: { question: "Need clarification" },
				partial: true,
				isNativeToolCall: true,
				call_id: "call-1",
				ts: Date.now(),
			},
		]

		const fakeTask = {
			genMessageTs: () => Date.now(),
			say: async (
				_type: string,
				text: string,
				_images: unknown,
				_files: unknown,
				partial: boolean,
				existingTs?: number,
			) => {
				sayCalls.push({ text, partial, ts: existingTs ?? 0 })
				return existingTs
			},
			messageStateHandler: {
				clineMessages: () => [],
				updateTaskHistory: async () => {},
				flushMessageUpdate: async (_index: number) => {},
			},
			taskState: {
				assistantMessageContent: [] as AssistantMessageContent[],
				currentStreamingContentIndex: 0,
				userMessageContentReady: true,
			},
		}

		await (
			Task.prototype as unknown as { processNativeToolCalls: (text: string, blocks: ToolUse[]) => Promise<void> }
		).processNativeToolCalls.call(fakeTask, "more text", toolBlocks)

		// Should NOT have a finalize say call — no prev text block exists
		const finalizeCalls = sayCalls.filter((c) => c.partial === false)
		assert.equal(finalizeCalls.length, 0, "Should not finalize when there is no prev text block")
	})

	it("moves turn-ending native tool calls after regular tool calls", async () => {
		const clineMessages: ClineMessage[] = []
		const toolBlocks: ToolUse[] = [
			{
				type: "tool_use",
				name: ClineDefaultTool.ATTEMPT,
				params: { result: "done" },
				partial: true,
				isNativeToolCall: true,
				call_id: "call-attempt",
				ts: Date.now(),
			},
			{
				type: "tool_use",
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "result.txt", content: "content" },
				partial: true,
				isNativeToolCall: true,
				call_id: "call-write",
				ts: Date.now(),
			},
		]

		const fakeTask = {
			genMessageTs: () => Date.now(),
			say: async () => undefined,
			messageStateHandler: {
				clineMessages: () => clineMessages,
				updateTaskHistory: async () => {},
				flushMessageUpdate: async (_index: number) => {},
			},
			taskState: {
				assistantMessageContent: [] as AssistantMessageContent[],
				currentStreamingContentIndex: 0,
				userMessageContentReady: true,
			},
		}

		await (
			Task.prototype as unknown as { processNativeToolCalls: (text: string, blocks: ToolUse[]) => Promise<void> }
		).processNativeToolCalls.call(fakeTask, "", toolBlocks)

		assert.deepEqual(
			fakeTask.taskState.assistantMessageContent.map((block) => (block.type === "tool_use" ? block.call_id : "")),
			["call-write", "call-attempt"],
		)
		assert.equal(fakeTask.taskState.currentStreamingContentIndex, 0)
		assert.equal(fakeTask.taskState.userMessageContentReady, false)
	})
})
