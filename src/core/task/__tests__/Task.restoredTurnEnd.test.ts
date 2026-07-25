import type { ToolUse } from "@core/assistant-message"
import { Task } from "@core/task"
import type { InteractionOutcome } from "@core/task/interaction/InteractionCoordinator"
import { TaskRuntime } from "@core/task/runtime/TaskRuntime"
import { createTaskRuntimeState } from "@core/task/runtime/TaskRuntimeState"
import { TaskPhase } from "@core/task/TaskPhase"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"

/** Exercise the restored handler boundary through the real turn reducer and presentation path. */
describe("Task restored turn-end continuation", () => {
	it("accepts the next assistant turn after a restored handler response", async () => {
		const restoredTurnId = "restored-turn"
		const restoredInteractionId = "restored-interaction"
		const restoredBlock: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.QNA_RESPOND,
			params: { response: "Restored answer" },
			partial: false,
			function_id: "function-restored",
			dline_tid: restoredInteractionId,
			ts: 100,
		}
		const nextBlock: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.ACT_MODE,
			params: { response: "Continue work" },
			partial: false,
			function_id: "function-next",
			dline_tid: "next-interaction",
			ts: 200,
		}
		const nextRuntimeBlock = {
			dlineTid: nextBlock.dline_tid,
			functionId: nextBlock.function_id,
			toolName: nextBlock.name,
			ts: nextBlock.ts,
			requiresApproval: true,
			conversationHistoryIndex: 7,
		}
		const runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({
					taskId: "task-1",
					phase: TaskPhase.STREAMING,
					revision: 5,
					anchor: { apiIndex: 4, turnId: restoredTurnId },
				}),
				turn: {
					turnId: restoredTurnId,
					assistantApiIndex: 4,
					mode: "serial",
					blocks: [
						{
							dlineTid: restoredInteractionId,
							functionId: restoredBlock.function_id,
							toolName: restoredBlock.name,
							phase: BlockPhase.AUTO_EXECUTING,
							ts: restoredBlock.ts,
							requiresApproval: false,
							conversationHistoryIndex: 4,
						},
					],
				},
			},
			{
				postView: async () => {},
				persistSnapshot: async () => {},
				cancelRuntime: async () => {},
				startApi: async () => {},
				executeTool: async () => {},
				appendSay: async () => {},
				appendAsk: async () => ({ uiMessageTs: 100 }),
				startNewTask: async () => {},
			},
		)
		const outcome: InteractionOutcome = {
			actionId: "reply",
			draft: { text: "write a file", images: [], files: [] },
		}
		const taskState = {
			abort: false,
			assistantMessageContent: [restoredBlock],
			currentStreamingContentIndex: 0,
			didAlreadyUseTool: false,
			didCompleteReadingStream: true,
			lastRenderedPartialByTs: new Map<number, string>(),
			partialToolLifecycleByTs: new Map<number, "partial-shown" | "complete-running" | "complete-done">(),
			presentAssistantMessageHasPendingUpdates: false,
			presentAssistantMessageLocked: false,
			userMessageContent: [],
			userMessageContentReady: false,
		}
		const presentAssistantMessage = Task.prototype.presentAssistantMessage
		const continueRestoredTurnEnd = (
			Task.prototype as unknown as {
				continueRestoredTurnEnd(
					kind: "qna_response",
					interactionId: string,
					messageTs: number,
					outcome: InteractionOutcome,
				): Promise<void>
			}
		).continueRestoredTurnEnd
		const fakeTask = {
			taskRuntime: runtime,
			dispatchRuntime: runtime.dispatch.bind(runtime),
			taskState,
			initialCheckpointCommitPromise: undefined,
			messageStateHandler: { apiConversationHistory: new Array(8).fill({ role: "assistant" }) },
			toolExecutor: {
				continueTurnEndInteraction: vi.fn(async () => "continued tool result"),
				isBlockApproved: () => false,
			},
			taskController: {
				buildTurn: vi.fn(),
				getBlocks: () => [nextRuntimeBlock],
				hasAnyRejection: () => false,
				shouldSkip: () => false,
			},
			isParallelToolCallingEnabled: () => false,
			reRenderUpdatedPartialBlocks: async () => undefined,
			findRestoredTurnEndBlock: () => restoredBlock,
			recursivelyMakeClineRequests: async () => {
				const started = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 6 })
				expect(started.accepted).toBe(true)
				taskState.assistantMessageContent = [nextBlock]
				taskState.currentStreamingContentIndex = 0
				taskState.didCompleteReadingStream = true
				await presentAssistantMessage.call(fakeTask as never)
				return false
			},
		} as unknown as Task

		await expect(
			continueRestoredTurnEnd.call(fakeTask, "qna_response", restoredInteractionId, 100, outcome),
		).resolves.toBeUndefined()
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.AWAITING_APPROVAL,
			turn: {
				turnId: "turn:next-interaction",
				blocks: [{ dlineTid: "next-interaction", phase: BlockPhase.AWAITING_APPROVAL }],
			},
		})
	})
})
