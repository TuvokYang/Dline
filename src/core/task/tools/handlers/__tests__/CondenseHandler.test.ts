import { strict as assert } from "node:assert"
import { describe, expect, it, vi } from "vitest"
import type { ToolUse } from "../../../../assistant-message"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { NO_TOOL_RESULT } from "../../utils/ToolResultUtils"
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
			addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		} as unknown as TaskConfig["messageState"],
		api: { getModel: () => ({ id: "test-model", info: { supportsImages: false } }) } as unknown as TaskConfig["api"],
		autoApprovalSettings: { enableNotifications: false } as unknown as TaskConfig["autoApprovalSettings"],
		autoApprover: { shouldAutoApproveTool: vi.fn().mockReturnValue(false) } as unknown as TaskConfig["autoApprover"],
		browserSettings: {} as unknown as TaskConfig["browserSettings"],
		focusChainSettings: { enabled: false } as unknown as TaskConfig["focusChainSettings"],
		interactions: {
			open: vi.fn(async () => ({ actionId: "confirm_utility" as const })),
			complete: vi.fn(async () => ({ actionId: "approve" as const })),
			say: vi.fn(async () => undefined),
		},
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
		dline_tid: `tid-${name}`,
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

			expect(config.interactions.open).not.toHaveBeenCalled()
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
		it("opens a typed interaction when block name is condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "test summary")

			await handler.execute(config, block)

			expect(config.interactions.open).toHaveBeenCalledWith({
				turnId: "turn:tid-condense",
				interactionId: "tid-condense",
				kind: "condense",
				presentation: "test summary",
				existingTs: block.ts,
			})
		})

		it("asks for a replacement summary when the user rejects with feedback", async () => {
			const config = createConfig()
			;(config.interactions.open as ReturnType<typeof vi.fn>).mockResolvedValue({
				actionId: "reject",
				draft: { text: "Keep the deployment details", images: [], files: [] },
			})
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "test summary")

			const result = await handler.execute(config, block)

			expect(config.callbacks.say).toHaveBeenCalledWith(
				"user_feedback",
				"Keep the deployment details",
				expect.any(Array),
				expect.any(Array),
			)
			assert.equal(typeof result, "string")
			expect(result).toContain('<explicit_instructions type="condense">')
			expect(result).toContain("Regenerate the summary now")
			expect(result).toContain("<feedback>\nKeep the deployment details\n</feedback>")
			expect(config.services.contextManager.getNextTruncationRange).not.toHaveBeenCalled()
		})

		it("regenerates without written feedback when the secondary action is clicked", async () => {
			const config = createConfig()
			;(config.interactions.open as ReturnType<typeof vi.fn>).mockResolvedValue({
				actionId: "reject",
				draft: { text: "", images: [], files: [] },
			})
			const handler = new CondenseHandler()

			const result = await handler.execute(config, makeBlock("condense", "test summary"))

			assert.equal(typeof result, "string")
			expect(result).toContain("No additional written feedback was provided.")
			expect(config.callbacks.say).not.toHaveBeenCalled()
			expect(config.services.contextManager.getNextTruncationRange).not.toHaveBeenCalled()
		})

		it("returns missing context error when context is empty for condense", async () => {
			const config = createConfig()
			const handler = new CondenseHandler()
			const block = makeBlock("condense", "")

			const result = await handler.execute(config, block)

			assert.equal(config.taskState.consecutiveMistakeCount, 1)
			assert.ok(typeof result === "string")
		})

		it("persists the accepted summary without committing an orphaned tool result", async () => {
			const config = createConfig()
			;(config.interactions.open as ReturnType<typeof vi.fn>).mockResolvedValue({
				actionId: "confirm_utility",
				draft: { text: "", images: [], files: [] },
			})
			const handler = new CondenseHandler()

			const result = await handler.execute(config, makeBlock("condense", "test summary"))

			// The truncation deleted the pairing tool_use turn; committing a
			// tool_result would orphan it and fail the next request.
			assert.equal(result, NO_TOOL_RESULT)
			expect(config.services.contextManager.getNextTruncationRange).toHaveBeenCalled()
			expect(config.messageState.addToApiConversationHistory).toHaveBeenCalledWith({
				role: "user",
				content: [{ type: "text", text: "test summary" }],
				ts: expect.any(Number),
			})
			expect(config.messageState.updateTaskHistory).toHaveBeenCalled()
		})
	})
})
