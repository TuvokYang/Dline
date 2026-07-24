import { describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@/shared/ExtensionMessage"

vi.unmock("@integrations/checkpoints")

import { createTaskCheckpointManager } from "../index"

interface RestoreHarness {
	manager: ReturnType<typeof createTaskCheckpointManager>
	taskState: {
		userMessageContent: unknown[]
		assistantMessageContent: unknown[]
		userMessageContentReady: boolean
		lastMessageTs?: number
		askId: string
	}
	resetHead: ReturnType<typeof vi.fn>
	restoreChatRuntime: ReturnType<typeof vi.fn>
	resumeTask: ReturnType<typeof vi.fn>
}

function createHarness(messages: ClineMessage[]): RestoreHarness {
	const taskState = {
		taskId: "task-1",
		userMessageContent: [{ type: "text", text: "active user content" }],
		assistantMessageContent: [{ type: "text", text: "active assistant content" }],
		userMessageContentReady: true,
		lastMessageTs: 99,
		askId: "task-1",
	}
	const resetHead = vi.fn().mockResolvedValue(undefined)
	const restoreChatRuntime = vi.fn().mockResolvedValue(undefined)
	const resumeTask = vi.fn().mockResolvedValue(undefined)
	const apiConversation = {
		count: 2,
		truncateByLineNum: vi.fn().mockResolvedValue(undefined),
		getAt: vi.fn(),
	}
	const uiMessage = { truncateByLineNum: vi.fn().mockResolvedValue(undefined) }
	const messageStateHandler = {
		clineMessages: messages,
		apiConversationHistory: [
			{ role: "user", content: "task" },
			{ role: "assistant", content: "answer" },
		],
		apiConversation,
		uiMessage,
		updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		setCheckpointTracker: vi.fn(),
	}
	const manager = createTaskCheckpointManager(
		{
			taskId: "task-1",
			controller: { task: { resumeTask } },
		} as never,
		{ enableCheckpoints: true },
		{
			fileContextTracker: { detectFilesEditedAfterMessage: vi.fn().mockResolvedValue([]) },
			diffViewProvider: {},
			messageStateHandler,
			taskState,
		} as never,
		{
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			cancelTask: vi.fn().mockResolvedValue(undefined),
			restoreChatRuntime,
			say: vi.fn().mockResolvedValue(100),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		} as never,
		{
			checkpointTracker: { resetHead } as never,
		},
	)
	return { manager, taskState, resetHead, restoreChatRuntime, resumeTask }
}

describe("TaskCheckpointManager restore isolation", () => {
	it("restores workspace files without clearing active chat state", async () => {
		const harness = createHarness([{ ts: 42, type: "say", say: "checkpoint_created", lastCheckpointHash: "hash-1" }])

		await harness.manager.restoreCheckpoint(42, "workspace")

		expect(harness.resetHead).toHaveBeenCalledWith("hash-1")
		expect(harness.taskState).toMatchObject({
			userMessageContent: [{ type: "text", text: "active user content" }],
			assistantMessageContent: [{ type: "text", text: "active assistant content" }],
			userMessageContentReady: true,
			lastMessageTs: 99,
		})
		expect(harness.restoreChatRuntime).not.toHaveBeenCalled()
		expect(harness.resumeTask).not.toHaveBeenCalled()
	})

	it("restores chat into a canonical paused runtime without auto-resuming", async () => {
		const harness = createHarness([
			{ ts: 42, type: "say", say: "text", conversationHistoryIndex: 0 },
			{ ts: 43, type: "say", say: "text" },
		])

		await harness.manager.restoreCheckpoint(42, "task")

		expect(harness.restoreChatRuntime).toHaveBeenCalledWith({ apiIndex: 1 })
		expect(harness.resumeTask).not.toHaveBeenCalled()
	})

	it("continues an edited chat restore exactly once through the typed runtime", async () => {
		const harness = createHarness([
			{ ts: 42, type: "say", say: "text", conversationHistoryIndex: 0 },
			{ ts: 43, type: "say", say: "text" },
		])

		await harness.manager.restoreCheckpoint(42, "task", undefined, "edited input")

		expect(harness.restoreChatRuntime).toHaveBeenCalledOnce()
		expect(harness.restoreChatRuntime).toHaveBeenCalledWith({ apiIndex: 1, editedText: "edited input" })
		expect(harness.resumeTask).not.toHaveBeenCalled()
	})
})
