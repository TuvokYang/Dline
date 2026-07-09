import { strict as assert } from "node:assert"
import { describe, expect, it, vi } from "vitest"
import type { ToolUse } from "../../../../assistant-message"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { CondenseHandler } from "../CondenseHandler"

function createConfig(overrides: Partial<TaskConfig> = {}): TaskConfig {
	const taskState = new TaskState()
	const clineMessages: Array<{ type: "say"; say: string; text?: string; ts: number }> = []
	const apiConversationHistory: Array<{ role: string }> = [{ role: "user" }, { role: "assistant" }]

	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/workspace",
		mode: "act",
		taskState,
		taskController: { rejectActiveBlock: vi.fn() } as unknown as TaskConfig["taskController"],
		messageState: {
			clineMessages,
			apiConversationHistory,
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		} as unknown as TaskConfig["messageState"],
		api: { getModel: () => ({ id: "test-model", info: { supportsImages: false } }) } as unknown as TaskConfig["api"],
		autoApprovalSettings: { enableNotifications: false } as unknown as TaskConfig["autoApprovalSettings"],
		autoApprover: { shouldAutoApproveTool: vi.fn().mockReturnValue(false) } as unknown as TaskConfig["autoApprover"],
		browserSettings: {} as unknown as TaskConfig["browserSettings"],
		focusChainSettings: { enabled: false } as unknown as TaskConfig["focusChainSettings"],
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? false : undefined),
				getApiConfiguration: () => ({ planModeProfile: "openai", actModeProfile: "openai" }),
			} as unknown,
			contextManager: {
				getNextTruncationRange: vi.fn().mockReturnValue([0, 1] as [number, number]),
				triggerApplyStandardContextTruncationNoticeChange: vi.fn().mockResolvedValue(undefined),
			} as unknown,
		} as unknown as TaskConfig["services"],
		callbacks: {
			say: vi.fn(async () => Date.now()),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [], files: [] }),
			saveCheckpoint: vi.fn(),
			shouldAutoApproveTool: vi.fn().mockReturnValue(false),
			shouldAutoApproveToolWithPath: vi.fn().mockResolvedValue(false),
			postStateToWebview: vi.fn(),
			setActiveHookExecution: vi.fn(),
			clearActiveHookExecution: vi.fn(),
			cancelTask: vi.fn(),
		} as unknown as TaskConfig["callbacks"],
		...overrides,
	} as unknown as TaskConfig
}

function makeBlock(name: string, context?: string): ToolUse {
	return {
		type: "tool_use",
		name,
		ts: Date.now(),
		params: { context: context ?? "summary content" },
		partial: false,
	} as unknown as ToolUse
}

describe("CondenseHandler", () => {
	describe("auto-condense mode", () => {
		it("skips ask() and directly clears context when block name is auto-condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("auto-condense", "test summary")

			const result = await handler.execute(config, block)

			expect(config.callbacks.ask).not.toHaveBeenCalled()
			expect(config.services.contextManager.getNextTruncationRange).toHaveBeenCalled()
			expect(config.messageState.updateTaskHistory).toHaveBeenCalled()
			assert.ok(typeof result === "string")
		})

		it("returns missing context error when context is empty for auto-condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("auto-condense", "")

			const result = await handler.execute(config, block)

			assert.equal(config.taskState.consecutiveMistakeCount, 1)
			assert.ok(typeof result === "string")
		})
	})

	describe("condense mode (manual)", () => {
		it("calls ask() for user interaction when block name is condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "test summary")

			await handler.execute(config, block)

			expect(config.callbacks.ask).toHaveBeenCalledWith(
				"condense",
				"test summary",
				false,
				expect.objectContaining({ existingTs: block.ts }),
			)
		})

		it("treats user input as feedback when text is provided in condense mode", async () => {
			const config = createConfig()
			;(config.callbacks.ask as ReturnType<typeof vi.fn>).mockResolvedValue({
				response: "messageResponse",
				text: "I want to keep chatting",
				images: [],
				files: [],
			})
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "test summary")

			const result = await handler.execute(config, block)

			expect(config.callbacks.say).toHaveBeenCalledWith(
				"user_feedback",
				"I want to keep chatting",
				expect.any(Array),
				expect.any(Array),
			)
			assert.ok(typeof result === "string")
		})

		it("returns missing context error when context is empty for condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "")

			const result = await handler.execute(config, block)

			assert.equal(config.taskState.consecutiveMistakeCount, 1)
			assert.ok(typeof result === "string")
		})
	})
})
