import type { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { TaskState } from "../../TaskState"
import { ExecuteCommandToolHandler } from "../../tools/handlers/ExecuteCommandToolHandler"
import { FocusChainHandler } from "../../tools/handlers/FocusChainHandler"
import { QnaRespondHandler } from "../../tools/handlers/QnaRespondHandler"
import { SpawnTaskHandler } from "../../tools/handlers/SpawnTaskHandler"
import { StatusUpdateHandler } from "../../tools/handlers/StatusUpdateHandler"
import type { TaskConfig } from "../../tools/types/TaskConfig"

vi.mock("@core/prompts/i18n", () => ({
	getPrompt: vi.fn(() => "prompt"),
	renderPrompt: vi.fn(() => "prompt"),
}))

vi.mock("@core/prompts/responses", () => ({
	formatResponse: {
		toolResult: vi.fn((text: string) => text),
		toolDenied: vi.fn(() => "denied"),
		toolError: vi.fn((text: string) => text),
	},
}))

vi.mock("@integrations/notifications", () => ({
	showApprovalNotification: vi.fn(async () => undefined),
	showSystemNotification: vi.fn(),
}))

vi.mock("../../tools/utils/ToolHookUtils", () => ({
	ToolHookUtils: { runPreToolUseIfEnabled: vi.fn(async () => undefined) },
}))

/** Create one stable tool-use block. */
function block(name: ClineDefaultTool, params: Record<string, string>): ToolUse {
	return { type: "tool_use", name, params, partial: false, ts: 100, dline_tid: `tid-${name}` } as ToolUse
}

/** Create a focused handler configuration with typed interaction ports. */
function config(
	outcome: { actionId: string; text?: string; selection?: string[] } = { actionId: "reply", text: "feedback" },
): TaskConfig {
	const open = vi.fn(async () => ({
		actionId: outcome.actionId,
		draft: { text: outcome.text ?? "", images: [], files: [] },
		selection: outcome.selection ? { values: outcome.selection } : undefined,
	}))
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/workspace",
		mode: "act",
		isSubagentExecution: false,
		taskState: Object.assign(new TaskState(), { lastToolName: "read_file" }),
		interactions: { open, complete: open, say: vi.fn(async () => undefined) },
		callbacks: {
			askAsk: vi.fn(async () => {
				throw new Error("legacy ask must not be called")
			}),
			say: vi.fn(async () => 100),
			sayAndCreateMissingParamError: vi.fn(async () => "missing"),
			focusChainForceUpdate: vi.fn(async () => undefined),
			updateClineMessage: vi.fn(async () => undefined),
		} as unknown as TaskConfig["callbacks"],
		messageState: { clineMessages: [], updateTaskHistory: vi.fn(async () => []) } as unknown as TaskConfig["messageState"],
		taskController: { rejectActiveBlock: vi.fn() } as unknown as TaskConfig["taskController"],
		autoApprovalSettings: { actions: { focusChain: false } } as TaskConfig["autoApprovalSettings"],
	} as unknown as TaskConfig
}

describe("handler interaction matrix", () => {
	it("opens Q&A as qna_response", async () => {
		const taskConfig = config()
		await new QnaRespondHandler().execute(taskConfig, block(ClineDefaultTool.QNA_RESPOND, { response: "Answer" }))
		expect(taskConfig.interactions.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "qna_response", presentation: JSON.stringify({ response: "Answer" }) }),
		)
	})

	it("opens acknowledged status as status_acknowledgment", async () => {
		const taskConfig = config({ actionId: "acknowledge", text: "ok" })
		await new StatusUpdateHandler().execute(
			taskConfig,
			block(ClineDefaultTool.STATUS_UPDATE, { response: "Checkpoint", requires_acknowledgment: "true" }),
		)
		expect(taskConfig.interactions.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "status_acknowledgment", presentation: "Checkpoint" }),
		)
	})

	it("presents non-acknowledged status as say only", async () => {
		const taskConfig = config()
		await new StatusUpdateHandler().execute(
			taskConfig,
			block(ClineDefaultTool.STATUS_UPDATE, { response: "Working", requires_acknowledgment: "false" }),
		)
		expect(taskConfig.interactions.say).toHaveBeenCalledWith(
			expect.objectContaining({
				taskSay: "tool",
				presentation: JSON.stringify({ tool: "statusUpdate", content: "Working" }),
			}),
		)
		expect(taskConfig.interactions.open).not.toHaveBeenCalled()
	})

	it("opens spawn approval as spawn_task_approval", async () => {
		const taskConfig = config({ actionId: "reject" })
		await new SpawnTaskHandler().execute(
			taskConfig,
			block(ClineDefaultTool.SPAWN_TASK, { task: "Child", context: "Context" }),
		)
		expect(taskConfig.interactions.open).toHaveBeenCalledWith(expect.objectContaining({ kind: "spawn_task_approval" }))
	})

	it("opens manual command approval as command_approval without legacy ask", async () => {
		const taskConfig = config({ actionId: "approve" })
		Object.assign(taskConfig, {
			api: { getModel: vi.fn(() => ({ id: "test-model" })) },
			services: {
				stateManager: {
					getApiConfiguration: vi.fn(() => ({})),
					getGlobalSettingsKey: vi.fn(() => "act"),
				},
				commandPermissionController: { validateCommand: vi.fn(() => ({ allowed: true })) },
				clineIgnoreController: { validateCommand: vi.fn(() => undefined) },
			},
			autoApprover: { shouldAutoApproveTool: vi.fn(() => [false, false]) },
			autoApprovalSettings: { enableNotifications: false },
			isMultiRootEnabled: false,
		})
		taskConfig.callbacks.ask = vi.fn(async () => ({ response: "yesButtonClicked" as const }))
		taskConfig.callbacks.executeCommandTool = vi.fn(async () => ({
			userRejected: false,
			result: "ok",
			completed: true,
			exitCode: 0,
			signal: null,
		}))

		await new ExecuteCommandToolHandler().execute(
			taskConfig,
			block(ClineDefaultTool.BASH, { command: "echo ok", requires_approval: "true" }),
		)

		expect(taskConfig.interactions.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "command_approval", presentation: "echo ok" }),
		)
		expect(taskConfig.callbacks.ask).not.toHaveBeenCalled()
	})

	it("rejects interaction opening without canonical dline identity", async () => {
		const taskConfig = config()
		const missingIdentity = block(ClineDefaultTool.QNA_RESPOND, { response: "Answer" })
		delete (missingIdentity as Partial<typeof missingIdentity>).dline_tid

		await expect(new QnaRespondHandler().execute(taskConfig, missingIdentity)).rejects.toThrow(
			"Canonical tool interaction is missing dlineTid",
		)
		expect(taskConfig.interactions.open).not.toHaveBeenCalled()
	})

	it("applies focus-chain selection with canonical block identity", async () => {
		const taskConfig = config({ actionId: "approve", selection: ["1"] })
		const focusChainForceUpdate = taskConfig.callbacks.focusChainForceUpdate
		await new FocusChainHandler().execute(
			taskConfig,
			block(ClineDefaultTool.FOCUS_CHAIN_CHANGE, { new_plan: "# Plan\n- [ ] First\n- [ ] Second", reason: "Change" }),
		)
		expect(taskConfig.interactions.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "focus_chain_change", interactionId: `tid-${ClineDefaultTool.FOCUS_CHAIN_CHANGE}` }),
		)
		expect(focusChainForceUpdate).toHaveBeenCalledWith("# Plan\n- [ ] Second")
	})
})
