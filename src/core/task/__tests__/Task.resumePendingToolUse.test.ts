import { strict as assert } from "node:assert"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"

type PendingToolUseResumeStateForTest = {
	assistantIndex: number
	toolUseBlocks: ClineAssistantToolUseBlock[]
	answeredToolResults: ClineUserToolResultContentBlock[]
	sanitizedHistory: ClineStorageMessage[]
}

type TaskPrivateForTest = {
	getPendingToolUseResumeState: (history: ClineStorageMessage[]) => PendingToolUseResumeStateForTest | undefined
	resumePendingToolUseFromHistory: (pendingToolUse: PendingToolUseResumeStateForTest) => Promise<void>
	taskState: {
		assistantMessageContent: Array<{ name: string; params: Record<string, string>; call_id?: string }>
		toolUseIdMap: Map<string, string>
		userMessageContent: unknown[]
		userMessageContentReady: boolean
	}
}

function createTaskLike<T extends object>(overrides: T) {
	return Object.assign(Object.create(Task.prototype), overrides) as T & TaskPrivateForTest
}

describe("Task pending tool-use history resume", () => {
	it("detects the latest assistant tool_use that is not followed by a matching tool_result", () => {
		const task = createTaskLike({})
		const history: ClineStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: "start" }],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_read",
						name: ClineDefaultTool.FILE_READ,
						input: { path: "src/index.ts" },
						call_id: "call_read",
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "corrupted resume message without tool_result" }],
			},
		]

		const pending = task.getPendingToolUseResumeState(history)

		assert.ok(pending)
		assert.equal(pending.assistantIndex, 1)
		assert.equal(pending.toolUseBlocks.length, 1)
		assert.equal(pending.toolUseBlocks[0].id, "toolu_read")
		assert.deepEqual(pending.answeredToolResults, [])
		assert.deepEqual(pending.sanitizedHistory, history.slice(0, 2))
	})

	it("carries forward existing tool_result blocks when only some parallel tool calls are unanswered", () => {
		const task = createTaskLike({})
		const answeredResult: ClineUserToolResultContentBlock = {
			type: "tool_result",
			tool_use_id: "toolu_read",
			content: "file contents",
		}
		const history: ClineStorageMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_read",
						name: ClineDefaultTool.FILE_READ,
						input: { path: "src/index.ts" },
						call_id: "call_read",
					},
					{
						type: "tool_use",
						id: "toolu_list",
						name: ClineDefaultTool.LIST_FILES,
						input: { path: "src" },
						call_id: "call_list",
					},
				],
			},
			{
				role: "user",
				content: [answeredResult, { type: "text", text: "corrupted non-tool content" }],
			},
		]

		const pending = task.getPendingToolUseResumeState(history)

		assert.ok(pending)
		assert.deepEqual(
			pending.toolUseBlocks.map((block) => block.id),
			["toolu_list"],
		)
		assert.deepEqual(pending.answeredToolResults, [answeredResult])
		assert.deepEqual(pending.sanitizedHistory, history.slice(0, 1))
	})

	it("does not resume an assistant tool_use that already has matching tool_result content", () => {
		const task = createTaskLike({})
		const history: ClineStorageMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_read",
						name: ClineDefaultTool.FILE_READ,
						input: { path: "src/index.ts" },
						call_id: "call_read",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_read",
						content: "file contents",
					},
				],
			},
		]

		assert.equal(task.getPendingToolUseResumeState(history), undefined)
	})

	it("restores pending tool_use blocks into the normal tool execution path", async () => {
		const storedToolUseBlocks: ClineAssistantToolUseBlock[] = [
			{
				type: "tool_use",
				id: "toolu_read",
				name: ClineDefaultTool.FILE_READ,
				input: { path: "src/index.ts" },
				call_id: "call_read",
			},
		]
		const clineMessages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "stale approval" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "400" },
		]
		const sanitizedHistory: ClineStorageMessage[] = [
			{
				role: "assistant",
				content: storedToolUseBlocks,
			},
		]

		let overwrittenHistory: ClineStorageMessage[] | undefined
		let removedMessageTs: number[] = []
		let continuedWith: unknown[] | undefined
		let checkpointSaved = false

		const task = createTaskLike({
			taskState: {
				currentStreamingContentIndex: -1,
				assistantMessageContent: [],
				didCompleteReadingStream: false,
				userMessageContent: [],
				userMessageContentReady: false,
				didRejectTool: true,
				didAlreadyUseTool: true,
				presentAssistantMessageLocked: true,
				presentAssistantMessageHasPendingUpdates: true,
				toolUseIdMap: new Map<string, string>(),
			},
			messageStateHandler: {
				getClineMessages: () => clineMessages,
				overwriteApiConversationHistory: async (history: ClineStorageMessage[]) => {
					overwrittenHistory = history
				},
				removeMessagesByTs: async (tsList: number[]) => {
					removedMessageTs = tsList
				},
			},
			postStateToWebview: async () => undefined,
			presentAssistantMessage: async function (this: {
				taskState: { userMessageContent: unknown[]; userMessageContentReady: boolean }
			}) {
				this.taskState.userMessageContent.push({
					type: "tool_result",
					tool_use_id: "toolu_read",
					content: "file contents",
				})
				this.taskState.userMessageContentReady = true
			},
			checkpointManager: {
				saveCheckpoint: async () => {
					checkpointSaved = true
				},
			},
			recursivelyMakeClineRequests: async (content: unknown[]) => {
				continuedWith = content
				return false
			},
		})

		await task.resumePendingToolUseFromHistory({
			assistantIndex: 0,
			toolUseBlocks: storedToolUseBlocks,
			answeredToolResults: [],
			sanitizedHistory,
		})

		assert.deepEqual(overwrittenHistory, sanitizedHistory)
		assert.deepEqual(removedMessageTs, [1, 2])
		const restoredAssistantContent = task.taskState.assistantMessageContent as Array<{
			name: string
			params: Record<string, string>
			call_id?: string
		}>
		assert.equal(restoredAssistantContent.length, 1)
		assert.equal(restoredAssistantContent[0].name, ClineDefaultTool.FILE_READ)
		assert.equal(restoredAssistantContent[0].params.path, "src/index.ts")
		assert.equal(restoredAssistantContent[0].call_id, "call_read")
		assert.equal(task.taskState.toolUseIdMap.get("call_read"), "toolu_read")
		assert.equal(checkpointSaved, true)
		assert.deepEqual(continuedWith, [
			{
				type: "tool_result",
				tool_use_id: "toolu_read",
				content: "file contents",
			},
		])
	})
})
