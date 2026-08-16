import { strict as assert } from "node:assert"
import type { CommandExecutionOutcome } from "@integrations/terminal"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it, vi } from "vitest"
import type { ToolUse } from "../../../../assistant-message"
import type { InteractionOutcome } from "../../../interaction/InteractionCoordinator"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { AttemptCompletionHandler } from "../AttemptCompletionHandler"

/**
 * Create a minimal task config for attempt_completion behavior tests.
 * @param taskState Mutable task state used by the handler.
 * @returns TaskConfig with mocked callbacks and services.
 */
function createConfig(
	taskState: TaskState,
	outcome: { actionId: "reply" | "start_new_task"; text?: string } = { actionId: "start_new_task" },
	commandResult: CommandExecutionOutcome = {
		userRejected: false,
		result: "",
		completed: true,
		exitCode: 0,
		signal: null,
	},
): TaskConfig {
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
		interactions: {
			open: vi.fn(async () => ({
				actionId: outcome.actionId,
				draft: { text: outcome.text ?? "", images: [], files: [] },
			})),
			complete: vi.fn(async () => ({
				actionId: outcome.actionId,
				draft: { text: outcome.text ?? "", images: [], files: [] },
			})),
			say: vi.fn(async () => undefined),
		},
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
		coordinator: {} as TaskConfig["coordinator"],
		identityFactory: {
			/** Return a stable result item identity for this fixture. */
			nextItemId: () => "dline_item_attempt_completion_test",
			/** Return a stable trace identity for this fixture. */
			nextTraceId: () => "dline_tid_attempt_completion_test",
		},
		callbacks: {
			say: vi.fn(async (type: string, text?: string) => {
				clineMessages.push({ type: "say", say: type, text, ts: Date.now() })
				return Date.now()
			}),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			saveCheckpoint: vi.fn().mockResolvedValue(undefined),
			doesLatestTaskCompletionHaveNewChanges: vi.fn().mockResolvedValue(false),
			updateFCListFromToolResponse: vi.fn().mockResolvedValue(undefined),
			executeCommandTool: vi.fn().mockResolvedValue(commandResult),
			runUserPromptSubmitHook: vi.fn().mockResolvedValue({}),
		} as unknown as TaskConfig["callbacks"],
	} as unknown as TaskConfig
}

/**
 * Create an attempt_completion tool block for handler execution.
 * @returns Complete attempt_completion tool block.
 */
function createBlock(command?: string): ToolUse {
	return {
		type: "tool_use",
		function_id: "completion-function-1",
		name: ClineDefaultTool.ATTEMPT,
		params: { result: "done", ...(command ? { command } : {}) },
		partial: false,
		ts: 123,
		dline_tid: "completion-1",
	} as ToolUse
}

type CommandApprovalContinuation = {
	continueCommandApproval(config: TaskConfig, block: ToolUse, outcome: InteractionOutcome): Promise<unknown>
}

describe("AttemptCompletionHandler stop behavior", () => {
	it("continues a restored command approval from the post-approval boundary", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState)
		const handler = new AttemptCompletionHandler() as AttemptCompletionHandler & CommandApprovalContinuation

		await handler.continueCommandApproval(config, createBlock("echo restored"), { actionId: "approve" })

		expect(config.interactions.open).not.toHaveBeenCalled()
		expect(config.callbacks.executeCommandTool).toHaveBeenCalledWith("echo restored", undefined, {
			commandTs: undefined,
		})
		expect(config.interactions.complete).toHaveBeenCalledOnce()
	})

	it("consumes a restored command rejection without executing or completing", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState)
		const handler = new AttemptCompletionHandler() as AttemptCompletionHandler & CommandApprovalContinuation

		await handler.continueCommandApproval(config, createBlock("echo rejected"), { actionId: "reject" })

		expect(config.taskController.rejectActiveBlock).toHaveBeenCalledOnce()
		expect(config.callbacks.executeCommandTool).not.toHaveBeenCalled()
		expect(config.interactions.complete).not.toHaveBeenCalled()
	})

	it("returns terminal completion when the runtime starts a new task", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState)
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, createBlock())

		assert.equal(result, "[attempt_completion] Result: Done")
	})

	it("keeps the command card separate and presents the non-empty completion result", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState)

		await new AttemptCompletionHandler().execute(config, createBlock("echo done"))

		expect(config.callbacks.say).toHaveBeenCalledWith("command", "echo done", undefined, undefined, false)
		expect(config.interactions.complete).toHaveBeenCalledWith({
			turnId: "turn:completion-1",
			interactionId: "completion-1",
			completionId: "completion-1",
			presentation: "done",
			existingTs: 123,
		})
	})

	it("does not complete the task when its approved command fails", async () => {
		const taskState = new TaskState()
		const config = createConfig(
			taskState,
			{ actionId: "start_new_task" },
			{
				userRejected: false,
				result: "Command failed with exit code 2.",
				completed: true,
				exitCode: 2,
				signal: null,
			},
		)
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, createBlock("false"))

		assert.equal(vi.mocked(config.interactions.complete).mock.calls.length, 0)
		assert.equal(
			vi.mocked(config.callbacks.say).mock.calls.some(([type]) => type === "completion_result"),
			false,
		)
		assert.equal(vi.mocked(config.callbacks.saveCheckpoint).mock.calls.length, 0)
		assert.match(String(result), /Command failed with exit code 2/)
	})

	it("does not complete the task when its command is cancelled by the user", async () => {
		const taskState = new TaskState()
		const config = createConfig(
			taskState,
			{ actionId: "start_new_task" },
			{
				userRejected: true,
				result: "Command was cancelled by the user.",
				completed: false,
				exitCode: null,
				signal: null,
			},
		)

		const result = await new AttemptCompletionHandler().execute(config, createBlock("long-running"))

		assert.equal(vi.mocked(config.interactions.complete).mock.calls.length, 0)
		assert.equal(vi.mocked(config.callbacks.saveCheckpoint).mock.calls.length, 0)
		assert.match(String(result), /cancelled by the user/)
	})

	it("returns completion feedback when the user replies", async () => {
		const taskState = new TaskState()
		const config = createConfig(taskState, { actionId: "reply", text: "Please refine the result" })
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, createBlock())

		assert.deepEqual(result, [
			{ type: "text", text: "[attempt_completion] Result: Done" },
			{
				type: "text",
				text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
			},
			{ type: "text", text: "<feedback>\nPlease refine the result\n</feedback>" },
		])
	})
})
