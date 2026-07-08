import { strict as assert } from "node:assert"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it, vi } from "vitest"
import type { ToolUse } from "../../../../assistant-message"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { AttemptCompletionHandler } from "../AttemptCompletionHandler"

/**
 * Create a minimal task config for attempt_completion behavior tests.
 * @param taskState Mutable task state used by the handler.
 * @returns TaskConfig with mocked callbacks and services.
 */
function createConfig(taskState: TaskState): TaskConfig {
	const clineMessages: Array<{ type: "say"; say: string; text?: string; ts: number }> = []
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "e:\\workspace\\vscode\\dline",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		taskState,
		taskController: {
			rejectActiveBlock: vi.fn(),
		} as unknown as TaskConfig["taskController"],
		messageState: {
			clineMessages,
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		} as unknown as TaskConfig["messageState"],
		api: {
			getModel: () => ({ id: "test-model", info: { supportsImages: false } }),
		} as unknown as TaskConfig["api"],
		autoApprovalSettings: { enableNotifications: false } as unknown as TaskConfig["autoApprovalSettings"],
		autoApprover: { shouldAutoApproveTool: vi.fn().mockReturnValue([true, true]) } as unknown as TaskConfig["autoApprover"],
		browserSettings: {} as unknown as TaskConfig["browserSettings"],
		focusChainSettings: { enabled: false } as unknown as TaskConfig["focusChainSettings"],
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? false : undefined),
				getApiConfiguration: () => ({ planModeProfile: "openai", actModeProfile: "openai" }),
			} as unknown,
		} as unknown as TaskConfig["services"],
		callbacks: {
			say: vi.fn(async (type: string, text?: string) => {
				clineMessages.push({ type: "say", say: type, text, ts: Date.now() })
				return Date.now()
			}),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			saveCheckpoint: vi.fn().mockResolvedValue(undefined),
			doesLatestTaskCompletionHaveNewChanges: vi.fn().mockResolvedValue(false),
			updateFCListFromToolResponse: vi.fn().mockResolvedValue(undefined),
			executeCommandTool: vi.fn().mockResolvedValue([false, ""]),
			runUserPromptSubmitHook: vi.fn().mockResolvedValue({}),
		} as unknown as TaskConfig["callbacks"],
	} as TaskConfig
}

/**
 * Create an attempt_completion tool block for handler execution.
 * @returns Complete attempt_completion tool block.
 */
function createBlock(): ToolUse {
	return {
		type: "tool_use",
		name: ClineDefaultTool.ATTEMPT,
		params: { result: "done" },
		partial: false,
		ts: 123,
	} as ToolUse
}

describe("AttemptCompletionHandler stop behavior", () => {
	it("marks the task as completed when the user confirms completion", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState)
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, createBlock())

		assert.equal(result, "[attempt_completion] Result: Done")
		assert.equal(taskState.didConfirmCompletion, true)
	})
})
