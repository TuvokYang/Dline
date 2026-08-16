import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { ContextCompactionSessionEvent } from "@core/task/ContextCompactionSession"
import type { ContextWindowIndicatorLineage, ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import { describe, expect, it, vi } from "vitest"
import { ContextWindowIndicator } from "../ContextWindowIndicator"
import { Task } from "../index"

type IndicatorTaskHarness = {
	taskId: string
	taskState: { contextWindowIndicator?: ContextWindowIndicatorSnapshot }
	contextWindowIndicator: ContextWindowIndicator
	ordinaryContextIndicatorLineageByApiIndex: Map<number, ContextWindowIndicatorLineage>
	ordinaryContextIndicatorReceivingByApiIndex: Map<number, { estimatedContentTokens: number; exactOutputTokens: number }>
	contextCompactionIndicatorReceivingByAttemptId: Map<string, { estimatedContentTokens: number; exactOutputTokens: number }>
	postStateToWebview: ReturnType<typeof vi.fn>
	publishContextWindowIndicatorSnapshot(snapshot: ContextWindowIndicatorSnapshot): Promise<void>
	receiveOrdinaryContextWindowIndicator(
		apiIndex: number,
		expectedLineage: ContextWindowIndicatorLineage,
		chunk: unknown,
	): Promise<void>
	rollbackOrdinaryContextWindowIndicator(apiIndex: number, expectedLineage?: ContextWindowIndicatorLineage): Promise<void>
	receiveContextCompactionIndicator(event: Extract<ContextCompactionSessionEvent, { kind: "pass_receiving" }>): Promise<void>
	commitContextCompactionIndicator(event: Extract<ContextCompactionSessionEvent, { kind: "pass_completed" }>): Promise<void>
}

function checkpointHead(operationId: string, overrides: Partial<CompactionCheckpointHead> = {}): CompactionCheckpointHead {
	return {
		schemaVersion: 1,
		operationId,
		rootCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		headCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		branchId: "branch-0",
		chainRevision: 0,
		sequence: 0,
		depth: 0,
		...overrides,
	}
}

function createHarness(): IndicatorTaskHarness {
	const contextWindowIndicator = new ContextWindowIndicator({
		taskId: "task-stale-indicator",
		durableContextTokens: 100,
		environmentTokens: 20,
		contextWindow: 1_000,
		mode: "act",
		updatedAt: 1,
	})
	return Object.assign(Object.create(Task.prototype), {
		taskId: "task-stale-indicator",
		taskState: {
			contextWindowIndicator: contextWindowIndicator.getSnapshot(),
		},
		contextWindowIndicator,
		ordinaryContextIndicatorLineageByApiIndex: new Map(),
		ordinaryContextIndicatorReceivingByApiIndex: new Map(),
		contextCompactionIndicatorReceivingByAttemptId: new Map(),
		postStateToWebview: vi.fn(async () => undefined),
	}) as IndicatorTaskHarness
}

const ordinaryAttempt0: ContextWindowIndicatorLineage = {
	kind: "ordinary",
	requestId: "ordinary:task-stale-indicator:3",
	requestSequence: 3,
	attemptId: "attempt-0",
}

const ordinaryAttempt1: ContextWindowIndicatorLineage = {
	kind: "ordinary",
	requestId: "ordinary:task-stale-indicator:3",
	requestSequence: 3,
	attemptId: "attempt-1",
}

const passAttempt1: ContextWindowIndicatorLineage = {
	kind: "compaction_pass",
	operationId: "operation-stale",
	passIndex: 0,
	attemptIndex: 1,
	attemptId: "pass-attempt-1",
	headCheckpointId: "checkpoint-0",
	chainRevision: 0,
	branchId: "branch-0",
}

describe("Task context-window indicator stale protection", () => {
	it("publishes only snapshots with a strictly greater Task revision", async () => {
		const task = createHarness()
		const current = task.contextWindowIndicator.beginSend({
			lineage: ordinaryAttempt0,
			durableContextTokens: 100,
			pendingSendTokens: 200,
			environmentTokens: 20,
			contextWindow: 1_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = current

		await task.publishContextWindowIndicatorSnapshot({ ...current, revision: current.revision - 1 })
		await task.publishContextWindowIndicatorSnapshot(current)

		expect(task.taskState.contextWindowIndicator).toEqual(current)
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})

	it("ignores receiving and rollback from an older ordinary retry attempt", async () => {
		const task = createHarness()
		const current = task.contextWindowIndicator.beginSend({
			lineage: ordinaryAttempt1,
			durableContextTokens: 100,
			pendingSendTokens: 200,
			environmentTokens: 20,
			contextWindow: 1_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = current
		task.ordinaryContextIndicatorLineageByApiIndex.set(3, ordinaryAttempt1)
		task.ordinaryContextIndicatorReceivingByApiIndex.set(3, {
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})

		await task.receiveOrdinaryContextWindowIndicator(3, ordinaryAttempt0, {
			type: "text",
			text: "late chunk",
		})
		await task.rollbackOrdinaryContextWindowIndicator(3, ordinaryAttempt0)

		expect(task.contextWindowIndicator.getSnapshot()).toEqual(current)
		expect(task.ordinaryContextIndicatorReceivingByApiIndex.get(3)).toEqual({
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})
		expect(task.ordinaryContextIndicatorLineageByApiIndex.get(3)).toEqual(ordinaryAttempt1)
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})

	it("does not revive receiving from the failed Pass attempt after retry", async () => {
		const task = createHarness()
		const current = task.contextWindowIndicator.beginSend({
			lineage: passAttempt1,
			durableContextTokens: 100,
			pendingSendTokens: 200,
			environmentTokens: 20,
			contextWindow: 1_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = current
		task.contextCompactionIndicatorReceivingByAttemptId.set("pass-attempt-0", {
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})
		const staleReceiving = {
			kind: "pass_receiving",
			state: {},
			passIdentity: { operationId: "operation-stale", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "pass-attempt-0" },
			checkpointHead: checkpointHead("operation-stale"),
			chunk: { type: "text", text: "late summary" },
		} as unknown as Extract<ContextCompactionSessionEvent, { kind: "pass_receiving" }>

		await task.receiveContextCompactionIndicator(staleReceiving)

		expect(task.contextWindowIndicator.getSnapshot()).toEqual(current)
		expect(task.contextCompactionIndicatorReceivingByAttemptId.get("pass-attempt-0")).toEqual({
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})

	it("rejects receiving and completion from a detached branch after restore", async () => {
		const task = createHarness()
		const restoreLineage: ContextWindowIndicatorLineage = {
			kind: "restore",
			operationId: "operation-stale",
			journalId: "restore-journal-1",
			targetCheckpointId: "checkpoint-0",
			headCheckpointId: "checkpoint-0",
			chainRevision: 1,
			branchId: "branch-1",
		}
		const restored = task.contextWindowIndicator.restore({
			lineage: restoreLineage,
			durableContextTokens: 100,
			environmentTokens: 20,
			contextWindow: 1_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = restored
		task.contextCompactionIndicatorReceivingByAttemptId.set("pass-attempt-0", {
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})
		const oldHead = checkpointHead("operation-stale")
		const staleReceiving = {
			kind: "pass_receiving",
			state: {},
			passIdentity: { operationId: "operation-stale", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "pass-attempt-0" },
			checkpointHead: oldHead,
			chunk: { type: "text", text: "late detached summary" },
		} as unknown as Extract<ContextCompactionSessionEvent, { kind: "pass_receiving" }>
		const staleCompleted = {
			kind: "pass_completed",
			state: {},
			passIdentity: { operationId: "operation-stale", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "pass-attempt-0" },
			previousCheckpointHead: oldHead,
			checkpointHead: checkpointHead("operation-stale", {
				headCheckpointId: "checkpoint-1",
				chainRevision: 1,
				sequence: 1,
				depth: 1,
			}),
			projection: {
				status: "complete",
				projectedUsageTokens: 300,
				targetContextWindow: 1_000,
				fittingExitTarget: 800,
				indicator: {
					durableContextTokens: 200,
					pendingSendTokens: 50,
					environmentTokens: 20,
					contextWindow: 1_000,
					mode: "act",
				},
			},
			content: "stale summary",
		} as unknown as Extract<ContextCompactionSessionEvent, { kind: "pass_completed" }>

		await task.receiveContextCompactionIndicator(staleReceiving)
		await task.commitContextCompactionIndicator(staleCompleted)

		expect(task.contextWindowIndicator.getSnapshot()).toEqual(restored)
		expect(task.contextCompactionIndicatorReceivingByAttemptId.get("pass-attempt-0")).toEqual({
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})
})
