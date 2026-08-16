import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import { SummarizeTaskHandler } from "../SummarizeTaskHandler"

const summaryBlock = {
	type: "tool_use",
	name: ClineDefaultTool.SUMMARIZE_TASK,
	partial: false,
	function_id: "call-summary-first",
	dline_tid: "dline-summary-first",
	ts: 12345,
	params: { context: "First generated summary" },
} as const

describe("SummarizeTaskHandler manual compatibility", () => {
	it("does not own regeneration, deleted-range, or canonical mutation", async () => {
		const apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "Initial task" }] },
			{ role: "assistant", content: [{ type: "text", text: "Previous response" }] },
		]
		const updateTaskHistory = vi.fn(async () => undefined)
		const taskState = {
			consecutiveMistakeCount: 0,
			isManualContextCompactionRequest: false,
			isInternalContextCompactionRequest: false,
			pendingManualCompactionRegeneration: undefined,
			conversationHistoryDeletedRange: undefined,
		}
		const config = {
			taskId: "task-regenerate",
			ulid: "task-regenerate",
			explicitInstructionAuthorization: {
				type: "summarize_task",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				state: "consumed",
				source: "manual_compact_command",
				operationId: "manual-operation",
			},
			taskState,
			messageState: {
				apiConversationHistory,
				clineMessages: [],
				updateTaskHistory,
			},
			services: {
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => false),
				},
				contextManager: {
					getContextTelemetryData: vi.fn(() => undefined),
				},
			},
			callbacks: {
				say: vi.fn(async () => undefined),
				sayAndCreateMissingParamError: vi.fn(),
			},
		} as unknown as TaskConfig
		const handler = new SummarizeTaskHandler({} as never)

		const result = await handler.execute(config, summaryBlock as never)

		expect(result).toContain("First generated summary")
		expect(taskState.pendingManualCompactionRegeneration).toBeUndefined()
		expect(taskState.conversationHistoryDeletedRange).toBeUndefined()
		expect(updateTaskHistory).not.toHaveBeenCalled()
		expect(apiConversationHistory).toHaveLength(2)
	})
})
