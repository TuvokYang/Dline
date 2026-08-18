import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { TargetWindowFittingState } from "@core/context/context-management/target-window-fitting"
import { describe, expect, it, vi } from "vitest"
import type { ContextCompactionRestoreResult } from "../ContextCompactionRecoveryCoordinator"
import { Task } from "../index"

function restoreResult(): ContextCompactionRestoreResult {
	const head: CompactionCheckpointHead = {
		schemaVersion: 1,
		operationId: "operation-boundary",
		rootCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		headCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		branchId: "branch-1",
		chainRevision: 2,
		sequence: 2,
		depth: 1,
	}
	const fittingState: TargetWindowFittingState = {
		operationId: head.operationId,
		sourceHistory: [],
		turns: [],
		protectedTail: [],
		coveredTurnCount: 0,
		passIndex: 0,
		passStartTurnIndex: 0,
		passEndTurnIndex: 0,
		cumulativeSummary: "",
		summaryBaselineHash: "empty",
		passPlanned: false,
	}
	return {
		operationId: head.operationId,
		checkpointId: head.headCheckpointId,
		head,
		phase: "pass_staged",
		fittingState,
	}
}

describe("Task context compaction recovery boundary", () => {
	it("replaces restored interaction feedback with the checkpoint resume draft while preserving tool identity", async () => {
		const restoredToolResult = {
			type: "tool_result" as const,
			function_id: "call-restored-qna",
			dline_tid: "dline-restored-qna",
			content: [{ type: "text" as const, text: "stale restored Q&A result" }],
		}
		const task = {
			taskRuntime: { getState: () => ({ phase: "resuming", turn: undefined }) },
			taskState: { userMessageContent: [restoredToolResult] },
			taskSm: { mode: "act" },
			messageStateHandler: {
				apiConversationHistory: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								name: "qna_respond",
								function_id: restoredToolResult.function_id,
								dline_tid: restoredToolResult.dline_tid,
								input: { response: "Restored question" },
							},
						],
					},
				],
				clineMessages: [],
			},
		} as unknown as Task
		const buildResumeApiContent = (
			Task.prototype as unknown as {
				buildResumeApiContent(draft: { text: string; images: string[]; files: string[] }): Promise<unknown[]>
			}
		).buildResumeApiContent

		const content = await buildResumeApiContent.call(task, {
			text: "continue after restore",
			images: [],
			files: [],
		})

		expect(content[0]).toMatchObject({
			type: "tool_result",
			function_id: restoredToolResult.function_id,
			dline_tid: restoredToolResult.dline_tid,
		})
		expect(JSON.stringify(content[0])).toContain("continue after restore")
		expect(JSON.stringify(content)).not.toContain("stale restored Q&A result")
		expect(JSON.stringify(content)).toContain("The previous task session was closed and has now been restored.")
	})

	it("completes the durable adoption journal before releasing the Session and transient owners", async () => {
		const order: string[] = []
		const completeAdoption = vi.fn(async () => {
			order.push("journal")
		})
		const settleContextCompactionIndicator = vi.fn(async () => {
			order.push("indicator")
		})
		const release = vi.fn(() => {
			order.push("session")
		})
		const snapshots = new Map([["operation-boundary", {}]])
		const clear = vi.fn(() => {
			order.push("presentation")
		})
		const task = {
			getContextCompactionRecoveryCoordinator: () => ({ completeAdoption }),
			settleContextCompactionIndicator,
			contextCompactionSession: { release },
			contextCompactionSnapshots: snapshots,
			contextCompactionPresentation: { clear },
			postStateToWebview: vi.fn(async () => undefined),
		} as unknown as Task

		await Task.prototype.releaseCompact.call(task, "operation-boundary")

		expect(order).toEqual(["journal", "indicator", "session", "presentation"])
		expect(snapshots.has("operation-boundary")).toBe(false)
	})

	it("keeps the Session barrier and transient owners when durable adoption completion fails", async () => {
		const completeAdoption = vi.fn(async () => {
			throw new Error("journal incomplete")
		})
		const release = vi.fn()
		const snapshots = new Map([["operation-boundary", {}]])
		const clear = vi.fn()
		const task = {
			getContextCompactionRecoveryCoordinator: () => ({ completeAdoption }),
			contextCompactionSession: { release },
			contextCompactionSnapshots: snapshots,
			contextCompactionPresentation: { clear },
		} as unknown as Task

		await expect(Task.prototype.releaseCompact.call(task, "operation-boundary")).rejects.toThrow("journal incomplete")
		expect(release).not.toHaveBeenCalled()
		expect(clear).not.toHaveBeenCalled()
		expect(snapshots.has("operation-boundary")).toBe(true)
	})

	it("delegates restoreTo, restorePrevious and restoreInitial to the single recovery coordinator", async () => {
		const result = restoreResult()
		const restore = vi.fn(async () => result)
		const restoreCheckpointChatRuntime = vi.fn(async () => undefined)
		const task = {
			restoreCompactionState: Reflect.get(Task.prototype, "restoreCompactionState"),
			getContextCompactionRecoveryCoordinator: () => ({ restore }),
			contextCompactionSession: { getActiveOperationId: () => undefined },
			restoreCheckpointChatRuntime,
			getRuntimeState: () => ({ anchor: { apiIndex: 12 } }),
		} as unknown as Task

		await expect(
			Task.prototype.restoreContextCompactionCheckpoint.call(
				task,
				"operation-boundary",
				"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				2,
			),
		).resolves.toBe(result)
		await expect(
			Task.prototype.restorePreviousContextCompactionCheckpoint.call(
				task,
				"operation-boundary",
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				2,
			),
		).resolves.toBe(result)
		await expect(
			Task.prototype.restoreInitialContextCompactionCheckpoint.call(
				task,
				"operation-boundary",
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				2,
			),
		).resolves.toBe(result)

		expect(restoreCheckpointChatRuntime).toHaveBeenCalledTimes(3)
		expect(restoreCheckpointChatRuntime).toHaveBeenNthCalledWith(1, { apiIndex: 12 })
		expect(restoreCheckpointChatRuntime).toHaveBeenNthCalledWith(2, { apiIndex: 12 })
		expect(restoreCheckpointChatRuntime).toHaveBeenNthCalledWith(3, { apiIndex: 12 })
		expect(restore.mock.calls).toEqual([
			[
				{
					operationId: "operation-boundary",
					target: {
						kind: "checkpoint",
						checkpointId: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
					},
					expectedHeadCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					expectedChainRevision: 2,
				},
			],
			[
				{
					operationId: "operation-boundary",
					target: { kind: "previous" },
					expectedHeadCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					expectedChainRevision: 2,
				},
			],
			[
				{
					operationId: "operation-boundary",
					target: { kind: "initial" },
					expectedHeadCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					expectedChainRevision: 2,
				},
			],
		])
	})

	it("lets an active compaction Session own checkpoint restore continuation without opening Resume", async () => {
		const result = restoreResult()
		const restore = vi.fn(async () => result)
		const restoreCheckpointChatRuntime = vi.fn(async () => undefined)
		const task = {
			restoreCompactionState: Reflect.get(Task.prototype, "restoreCompactionState"),
			getContextCompactionRecoveryCoordinator: () => ({ restore }),
			contextCompactionSession: { getActiveOperationId: () => "operation-boundary" },
			restoreCheckpointChatRuntime,
			getRuntimeState: () => ({ anchor: { apiIndex: 12 } }),
		} as unknown as Task

		await expect(
			Task.prototype.restoreContextCompactionCheckpoint.call(
				task,
				"operation-boundary",
				"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				2,
			),
		).resolves.toBe(result)

		expect(restore).toHaveBeenCalledOnce()
		expect(restoreCheckpointChatRuntime).not.toHaveBeenCalled()
	})
})
