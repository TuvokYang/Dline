import { createCompactionSourceSnapshot } from "@core/context/context-management/compaction-source-snapshot"
import { indexLogicalTurns } from "@core/context/context-management/logical-turns"
import { applyCompactionPassPlan, startTargetWindowFitting } from "@core/context/context-management/target-window-fitting"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import { NO_TOOL_RESULT } from "../../utils/ToolResultUtils"
import { SummarizeTaskHandler } from "../SummarizeTaskHandler"

function startFitting(sourceHistory: Parameters<typeof createCompactionSourceSnapshot>[0], operationId: string) {
	const snapshot = createCompactionSourceSnapshot(sourceHistory)
	return startTargetWindowFitting(indexLogicalTurns(snapshot.messages), operationId, snapshot)
}

const summaryBlock = {
	type: "tool_use",
	name: ClineDefaultTool.SUMMARIZE_TASK,
	partial: false,
	function_id: "call-stale-summary",
	dline_tid: "dline-stale-summary",
	ts: 12345,
	params: { context: "Stale generated summary" },
} as const

describe("SummarizeTaskHandler compaction attempt identity", () => {
	it("does not let a current fitting attempt mutate Session-owned state or canonical history", async () => {
		const sourceHistory = [
			{ role: "user" as const, content: [{ type: "text" as const, text: "Original task" }] },
			{ role: "assistant" as const, content: [{ type: "text" as const, text: "Original response" }] },
		]
		const initialState = startFitting(sourceHistory, "operation-current-attempt")
		const fittingState = applyCompactionPassPlan(initialState, {
			operationId: initialState.operationId,
			passIndex: initialState.passIndex,
			passStartTurnIndex: 0,
			passEndTurnIndex: 0,
			coveredTurnCount: 0,
			summaryBaselineHash: initialState.summaryBaselineHash,
			passHistoryHash: "sha256:current-pass",
			estimatedInputTokens: 10,
			passInputCeiling: 100,
		})
		const overwriteApiConversationHistory = vi.fn(async () => undefined)
		const updateTaskHistory = vi.fn(async () => undefined)
		const taskState = {
			consecutiveMistakeCount: 0,
			isManualContextCompactionRequest: false,
			isInternalContextCompactionRequest: true,
			targetWindowFittingState: fittingState,
			compactionFittingRequired: false,
			currentlySummarizing: false,
			conversationHistoryDeletedRange: undefined,
		}
		const config = {
			taskId: "task-current-attempt",
			ulid: "task-current-attempt",
			explicitInstructionAuthorization: {
				instructionId: "instruction-current",
				requestId: "request-current",
				attemptId: "authorization-attempt-current",
				type: "summarize_task",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				state: "consumed",
				source: "auto_compaction",
				operationId: fittingState.operationId,
			},
			compactionAttemptGuard: {
				isCurrent: vi.fn(() => true),
			},
			taskState,
			messageState: {
				apiConversationHistory: sourceHistory,
				overwriteApiConversationHistory,
				flushApiConversationHistory: vi.fn(async () => undefined),
				updateTaskHistory,
				clineMessages: [],
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

		await handler.execute(config, summaryBlock as never)

		expect(taskState.targetWindowFittingState).toBe(fittingState)
		expect(taskState.targetWindowFittingState.coveredTurnCount).toBe(0)
		expect(taskState.compactionFittingRequired).toBe(false)
		expect(taskState.currentlySummarizing).toBe(false)
		expect(taskState.conversationHistoryDeletedRange).toBeUndefined()
		expect(overwriteApiConversationHistory).not.toHaveBeenCalled()
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("discards a stale fitting attempt before it can advance the staged Pass", async () => {
		const sourceHistory = [
			{ role: "user" as const, content: [{ type: "text" as const, text: "Original task" }] },
			{ role: "assistant" as const, content: [{ type: "text" as const, text: "Original response" }] },
		]
		const fittingState = startFitting(sourceHistory, "operation-stale-attempt")
		const overwriteApiConversationHistory = vi.fn(async () => undefined)
		const taskState = {
			consecutiveMistakeCount: 0,
			isManualContextCompactionRequest: false,
			isInternalContextCompactionRequest: true,
			targetWindowFittingState: fittingState,
			compactionFittingRequired: false,
			currentlySummarizing: false,
		}
		const config = {
			taskId: "task-stale-attempt",
			ulid: "task-stale-attempt",
			explicitInstructionAuthorization: {
				instructionId: "instruction-stale",
				requestId: "request-stale",
				attemptId: "authorization-attempt-stale",
				type: "summarize_task",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				state: "consumed",
				source: "auto_compaction",
				operationId: fittingState.operationId,
			},
			compactionAttemptGuard: {
				isCurrent: vi.fn(() => false),
			},
			taskState,
			messageState: {
				apiConversationHistory: sourceHistory,
				overwriteApiConversationHistory,
				flushApiConversationHistory: vi.fn(async () => undefined),
				updateTaskHistory: vi.fn(async () => undefined),
				clineMessages: [],
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

		await expect(handler.execute(config, summaryBlock as never)).resolves.toBe(NO_TOOL_RESULT)

		expect(taskState.targetWindowFittingState).toBe(fittingState)
		expect(taskState.targetWindowFittingState.coveredTurnCount).toBe(0)
		expect(overwriteApiConversationHistory).not.toHaveBeenCalled()
	})
})
