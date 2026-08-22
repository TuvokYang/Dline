import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { ContextCompactionSessionEvent, ContextCompactionSessionInput } from "@core/task/ContextCompactionSession"
import {
	type ContextWindowIndicatorLineage,
	type ContextWindowIndicatorSnapshot,
	getContextWindowIndicatorTotalTokens,
} from "@shared/context-window-indicator"
import { describe, expect, it, vi } from "vitest"
import { ContextWindowIndicator } from "../ContextWindowIndicator"
import { ContextWindowReceivingTracker } from "../ContextWindowReceivingTracker"
import { Task } from "../index"

type IndicatorTaskHarness = {
	taskId: string
	taskState: { contextWindowIndicator?: ContextWindowIndicatorSnapshot }
	messageStateHandler: { clineMessages: Array<{ say?: string; text?: string }> }
	contextWindowIndicator: ContextWindowIndicator
	ordinaryContextIndicatorLineageByApiIndex: Map<number, ContextWindowIndicatorLineage>
	ordinaryContextIndicatorReceivingByApiIndex: Map<number, ContextWindowReceivingTracker>
	contextCompactionIndicatorReceivingByAttemptId: Map<string, ContextWindowReceivingTracker>
	postStateToWebview: ReturnType<typeof vi.fn>
	getContextWindowIndicatorProfile(mode: string, profileName?: string): { profileId?: string; profileName?: string }
	beginContextCompactionIndicator(
		input: ContextCompactionSessionInput,
		event: Extract<ContextCompactionSessionEvent, { kind: "pass_started" }>,
		attempt: { attemptIndex: number; authorizationAttemptId: string },
	): Promise<void>
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
		messageStateHandler: {
			clineMessages: [
				{
					say: "api_req_started",
					text: JSON.stringify({ contextTokens: 630_100, contextTokensSource: "provider" }),
				},
			],
		},
		contextWindowIndicator,
		ordinaryContextIndicatorLineageByApiIndex: new Map(),
		ordinaryContextIndicatorReceivingByApiIndex: new Map(),
		contextCompactionIndicatorReceivingByAttemptId: new Map(),
		postStateToWebview: vi.fn(async () => undefined),
		getContextWindowIndicatorProfile: vi.fn(() => ({})),
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
	it("keeps the authoritative total while a hidden compaction Pass is being sent", async () => {
		const task = createHarness()
		const checkpoint = checkpointHead("operation-stale", {
			headCheckpointId: "checkpoint-pass",
		})
		const stable = task.contextWindowIndicator.restore({
			lineage: {
				kind: "checkpoint",
				operationId: "operation-stale",
				checkpointId: "checkpoint-0",
				chainRevision: 0,
				branchId: "branch-0",
			},
			durableContextTokens: 630_100,
			environmentTokens: 0,
			contextWindow: 1_000_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = stable

		const input = {
			operationId: "operation-stale",
			trigger: "auto_compaction",
			compactionApi: {
				getModel: () => ({ id: "deepseek-v4-flash", info: { capabilities: { contextWindow: 1_000_000 } } }),
			},
			targetApi: {},
			targetMode: "act",
			sourceHistory: [],
			transition: {
				kind: "mode_switch",
				operationId: "operation-stale",
				phase: "compacting",
				source: { mode: "act" },
				target: { mode: "act", profile: "target-profile", contextWindow: 1_000_000 },
			},
		} as unknown as ContextCompactionSessionInput
		const event = {
			kind: "pass_started",
			state: { cumulativeSummary: undefined },
			passIdentity: { operationId: "operation-stale", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "pass-attempt-0" },
			checkpointHead: checkpoint,
			providerInput: {
				systemPrompt: "system",
				messages: [{ role: "user", content: [{ type: "text", text: "hidden pass source" }] }],
				tools: [],
				serverTools: [],
			},
		} as unknown as Extract<ContextCompactionSessionEvent, { kind: "pass_started" }>

		await task.beginContextCompactionIndicator(input, event, event.attempt)

		expect(getContextWindowIndicatorTotalTokens(task.contextWindowIndicator.getSnapshot())).toBe(630_100)
	})

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
		const activeReceiving = new ContextWindowReceivingTracker()
		task.ordinaryContextIndicatorReceivingByApiIndex.set(3, activeReceiving)

		await task.receiveOrdinaryContextWindowIndicator(3, ordinaryAttempt0, {
			type: "text",
			text: "late chunk",
		})
		await task.rollbackOrdinaryContextWindowIndicator(3, ordinaryAttempt0)

		expect(task.contextWindowIndicator.getSnapshot()).toEqual(current)
		expect(task.ordinaryContextIndicatorReceivingByApiIndex.get(3)).toBe(activeReceiving)
		expect(activeReceiving.getSnapshot().receivingTokens).toBe(0)
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
		const failedAttemptReceiving = new ContextWindowReceivingTracker()
		task.contextCompactionIndicatorReceivingByAttemptId.set("pass-attempt-0", failedAttemptReceiving)
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
		expect(task.contextCompactionIndicatorReceivingByAttemptId.get("pass-attempt-0")).toBe(failedAttemptReceiving)
		expect(failedAttemptReceiving.getSnapshot().receivingTokens).toBe(0)
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
		const detachedReceiving = new ContextWindowReceivingTracker()
		task.contextCompactionIndicatorReceivingByAttemptId.set("pass-attempt-0", detachedReceiving)
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
		expect(task.contextCompactionIndicatorReceivingByAttemptId.get("pass-attempt-0")).toBe(detachedReceiving)
		expect(detachedReceiving.getSnapshot().receivingTokens).toBe(0)
		expect(task.postStateToWebview).not.toHaveBeenCalled()
	})
})
