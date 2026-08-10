import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import { NO_TOOL_RESULT } from "../../utils/ToolResultUtils"
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

describe("SummarizeTaskHandler manual regeneration", () => {
	it("records the preceding user compaction request as the regeneration boundary", async () => {
		const apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "Initial task" }] },
			{ role: "assistant", content: [{ type: "text", text: "Previous response" }] },
			{ role: "user", content: [{ type: "text", text: "/compact" }] },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: ClineDefaultTool.SUMMARIZE_TASK,
						function_id: summaryBlock.function_id,
						dline_tid: summaryBlock.dline_tid,
						input: { context: summaryBlock.params.context },
					},
				],
			},
		]
		const taskState = {
			consecutiveMistakeCount: 0,
			isManualContextCompactionRequest: false,
			isInternalContextCompactionRequest: false,
			pendingManualCompactionRegeneration: undefined,
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
			messageState: { apiConversationHistory },
			services: {
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => false),
				},
			},
			interactions: {
				open: vi.fn(async () => ({
					actionId: "reject" as const,
					draft: {
						text: "Focus on the latest failure",
						images: [],
						files: [],
					},
				})),
			},
		} as unknown as TaskConfig
		const handler = new SummarizeTaskHandler({} as never)

		await expect(handler.execute(config, summaryBlock as never)).resolves.toBe(NO_TOOL_RESULT)

		expect(taskState.pendingManualCompactionRegeneration).toEqual({
			requestApiIndex: 2,
			operationId: "manual-operation",
			text: "Focus on the latest failure",
			images: [],
			files: [],
		})
		expect(apiConversationHistory[2]?.role).toBe("user")
	})
})
