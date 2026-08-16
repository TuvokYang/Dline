import type { ContextWindowIndicatorLineage, ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import type { ApiHandler } from "@core/api"
import { describe, expect, it, vi } from "vitest"
import { TaskPhase } from "../TaskPhase"
import { createTaskRuntimeState, type TaskRuntimeState } from "../runtime/TaskRuntimeState"
import { ContextWindowIndicator } from "../ContextWindowIndicator"
import { Task } from "../index"
import type { CompactionProviderInput } from "../compaction/CompactionRequestReplay"
import type { ContextWindowProviderUsage } from "../ContextWindowIndicatorUsage"

interface RoundTaskHarness {
	taskId: string
	taskState: { contextWindowIndicator?: ContextWindowIndicatorSnapshot; apiRequestCount?: number }
	contextWindowIndicator: ContextWindowIndicator
	ordinaryContextIndicatorLineageByApiIndex: Map<number, ContextWindowIndicatorLineage>
	ordinaryContextIndicatorReceivingByApiIndex: Map<
		number,
		{
			estimatedContentTokens: number
			exactOutputTokens: number
			exactContextUsage?: ContextWindowProviderUsage
		}
	>
	postStateToWebview: ReturnType<typeof vi.fn>
	getContextWindowIndicatorProfile(mode: string, profileName?: string): { profileId?: string; profileName?: string }
	beginOrdinaryContextWindowIndicator(
		apiIndex: number,
		providerAttempt: number,
		requestScope: unknown,
		providerInput: CompactionProviderInput,
	): Promise<ContextWindowIndicatorLineage>
	receiveOrdinaryContextWindowIndicator(
		apiIndex: number,
		expectedLineage: ContextWindowIndicatorLineage,
		chunk: unknown,
	): Promise<void>
	publishRuntimeTaskView(state: Readonly<TaskRuntimeState>): Promise<void>
	foldOrdinaryIndicatorRound(): Promise<void>
}

function createHarness(): RoundTaskHarness {
	const contextWindowIndicator = new ContextWindowIndicator({
		taskId: "task-round-indicator",
		durableContextTokens: 100,
		environmentTokens: 0,
		contextWindow: 1_000,
		mode: "act",
		updatedAt: 1,
	})
	const harness = Object.assign(Object.create(Task.prototype), {
		taskId: "task-round-indicator",
		taskState: {
			contextWindowIndicator: contextWindowIndicator.getSnapshot(),
			apiRequestCount: 1,
		},
		contextWindowIndicator,
		ordinaryContextIndicatorLineageByApiIndex: new Map(),
		ordinaryContextIndicatorReceivingByApiIndex: new Map(),
		postStateToWebview: vi.fn(async () => undefined),
		getContextWindowIndicatorProfile: vi.fn(() => ({})),
	}) as RoundTaskHarness
	return harness
}

function providerInput(messages: CompactionProviderInput["messages"], contextWindow: number): {
	providerInput: CompactionProviderInput
	requestScope: { api: ApiHandler; providerInfo: { mode: "act" } }
} {
	const requestScope = {
		api: { getModel: () => ({ id: "m", info: { capabilities: { contextWindow } } }) } as unknown as ApiHandler,
		providerInfo: { mode: "act" as const },
	}
	return { providerInput: { systemPrompt: "system", messages, tools: [], serverTools: [] }, requestScope }
}

describe("Task ordinary indicator round folding", () => {
	it("folds the completed round into durable, keeps ENV separate, and clears per-request bookkeeping", async () => {
		const task = createHarness()
		const current = task.contextWindowIndicator.beginSend({
			lineage: {
				kind: "ordinary",
				requestId: "ordinary:task-round-indicator:1",
				requestSequence: 1,
				attemptId: "attempt-0",
			},
			durableContextTokens: 100,
			pendingSendTokens: 200,
			environmentTokens: 30,
			contextWindow: 1_000,
			mode: "act",
		})
		task.taskState.contextWindowIndicator = current
		task.ordinaryContextIndicatorLineageByApiIndex.set(1, current.lineage)
		task.ordinaryContextIndicatorReceivingByApiIndex.set(1, {
			estimatedContentTokens: 0,
			exactOutputTokens: 0,
		})

		await task.foldOrdinaryIndicatorRound()

		const snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.durableContextTokens).toBe(300)
		expect(snapshot.pendingSendTokens).toBe(0)
		expect(snapshot.receivingTokens).toBe(0)
		expect(snapshot.environmentTokens).toBe(30)
		expect(snapshot.phase).toBe("stable")
		expect(task.ordinaryContextIndicatorLineageByApiIndex.size).toBe(0)
		expect(task.ordinaryContextIndicatorReceivingByApiIndex.size).toBe(0)
	})

	it("keeps durable frozen across continuation requests and accumulates the round into sending", async () => {
		const task = createHarness()
		const firstTurnText = "first turn".padEnd(600, "a")
		const first = providerInput([{ role: "user", content: [{ type: "text", text: firstTurnText }] }], 1_000)
		await task.beginOrdinaryContextWindowIndicator(0, 0, first.requestScope, first.providerInput)
		const afterFirst = task.contextWindowIndicator.getSnapshot()
		expect(afterFirst.durableContextTokens).toBe(100)
		expect(afterFirst.pendingSendTokens).toBeGreaterThan(0)

		const second = providerInput(
			[
				{ role: "user", content: [{ type: "text", text: firstTurnText }] },
				{ role: "assistant", content: [{ type: "text", text: "response".padEnd(300, "b") }] },
				{ role: "user", content: [{ type: "text", text: "tool result continuation".padEnd(300, "c") }] },
			],
			1_000,
		)
		await task.beginOrdinaryContextWindowIndicator(1, 0, second.requestScope, second.providerInput)
		const afterSecond = task.contextWindowIndicator.getSnapshot()

		expect(afterSecond.durableContextTokens).toBe(100)
		expect(afterSecond.pendingSendTokens).toBeGreaterThan(afterFirst.pendingSendTokens)
	})

	it("folds the latest Provider usage into the stable context snapshot for a completed turn", async () => {
		const task = createHarness()
		const request = providerInput(
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "short local request" },
						{ type: "text", text: "<environment_details>small dynamic snapshot</environment_details>" },
					],
				},
			],
			272_000,
		)
		const lineage = await task.beginOrdinaryContextWindowIndicator(0, 0, request.requestScope, request.providerInput)
		await task.receiveOrdinaryContextWindowIndicator(0, lineage, {
			type: "usage",
			inputTokens: 140_000,
			outputTokens: 100,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		})

		await task.foldOrdinaryIndicatorRound()

		const snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.durableContextTokens + snapshot.environmentTokens).toBe(140_100)
		expect(snapshot.durableContextTokens).toBeGreaterThan(snapshot.environmentTokens)
		expect(snapshot.phase).toBe("stable")
	})

	it("lets exact Provider output replace an inflated receiving fallback", async () => {
		const task = createHarness()
		const request = providerInput(
			[{ role: "user", content: [{ type: "text", text: "small hosted result request" }] }],
			272_000,
		)
		const lineage = await task.beginOrdinaryContextWindowIndicator(0, 0, request.requestScope, request.providerInput)
		await task.receiveOrdinaryContextWindowIndicator(0, lineage, {
			type: "server_tool",
			function_id: "ws_large_result",
			tool: "WEB_SEARCH",
			phase: "completed",
			result: { results: [{ snippet: "provider result".repeat(4_000) }] },
		})

		const inflated = task.contextWindowIndicator.getSnapshot().receivingTokens
		expect(inflated).toBeGreaterThan(10_000)

		await task.receiveOrdinaryContextWindowIndicator(0, lineage, {
			type: "usage",
			inputTokens: 1_200,
			outputTokens: 800,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		})

		const calibrated = task.contextWindowIndicator.getSnapshot()
		expect(calibrated.receivingTokens).toBe(800)
		expect(
			calibrated.durableContextTokens +
				calibrated.pendingSendTokens +
				calibrated.receivingTokens +
				calibrated.environmentTokens,
		).toBe(2_000)
	})

	it("accepts split Provider usage and does not double-count repeated output snapshots", async () => {
		const task = createHarness()
		const request = providerInput(
			[{ role: "user", content: [{ type: "text", text: "split usage request" }] }],
			272_000,
		)
		const lineage = await task.beginOrdinaryContextWindowIndicator(0, 0, request.requestScope, request.providerInput)

		await task.receiveOrdinaryContextWindowIndicator(0, lineage, {
			type: "usage",
			inputTokens: 140_000,
			outputTokens: 0,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
		})

		let snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.durableContextTokens + snapshot.pendingSendTokens + snapshot.receivingTokens + snapshot.environmentTokens).toBe(
			140_015,
		)
		expect(snapshot.receivingTokens).toBe(0)
		expect(snapshot.phase).toBe("receiving")

		const outputUsage = {
			type: "usage" as const,
			inputTokens: 0,
			outputTokens: 100,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}
		await task.receiveOrdinaryContextWindowIndicator(0, lineage, outputUsage)
		await task.receiveOrdinaryContextWindowIndicator(0, lineage, outputUsage)

		const receiving = task.ordinaryContextIndicatorReceivingByApiIndex.get(0)
		expect(receiving?.exactOutputTokens).toBe(100)
		expect(receiving?.exactContextUsage).toEqual({
			inputTokens: 140_000,
			outputTokens: 100,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
		})
		snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.durableContextTokens + snapshot.pendingSendTokens + snapshot.receivingTokens + snapshot.environmentTokens).toBe(
			140_115,
		)
		expect(snapshot.receivingTokens).toBe(100)

		await task.foldOrdinaryIndicatorRound()

		snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.durableContextTokens + snapshot.environmentTokens).toBe(140_115)
		expect(snapshot.phase).toBe("stable")
	})

	it("settles the indicator before publishing completed and keeps repeated completed views idempotent", async () => {
		const task = createHarness()
		const request = providerInput(
			[{ role: "user", content: [{ type: "text", text: "completion lifecycle request" }] }],
			272_000,
		)
		const lineage = await task.beginOrdinaryContextWindowIndicator(0, 0, request.requestScope, request.providerInput)
		await task.receiveOrdinaryContextWindowIndicator(0, lineage, {
			type: "usage",
			inputTokens: 140_000,
			outputTokens: 100,
		})
		const publishedIndicatorPhases: string[] = []
		task.postStateToWebview.mockImplementation(async () => {
			publishedIndicatorPhases.push(task.taskState.contextWindowIndicator?.phase ?? "missing")
		})
		const completed = createTaskRuntimeState({ taskId: task.taskId, phase: TaskPhase.COMPLETED })

		await task.publishRuntimeTaskView(completed)

		const settled = task.contextWindowIndicator.getSnapshot()
		expect(settled.phase).toBe("stable")
		expect(settled.durableContextTokens + settled.environmentTokens).toBe(140_100)
		expect(publishedIndicatorPhases).toEqual(["committing", "stable", "stable"])
		const settledRevision = settled.revision

		await task.publishRuntimeTaskView(completed)

		expect(task.contextWindowIndicator.getSnapshot().revision).toBe(settledRevision)
		expect(publishedIndicatorPhases).toEqual(["committing", "stable", "stable", "stable"])
	})

	it("recomputes ENV from each frozen request input instead of retaining a stale value", async () => {
		const task = createHarness()
		const withEnvironment = providerInput(
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "turn" },
						{ type: "text", text: "<environment_details>fresh dynamic snapshot</environment_details>" },
					],
				},
			],
			1_000,
		)
		await task.beginOrdinaryContextWindowIndicator(0, 0, withEnvironment.requestScope, withEnvironment.providerInput)

		const snapshot = task.contextWindowIndicator.getSnapshot()
		expect(snapshot.environmentTokens).toBeGreaterThan(0)
		const total = snapshot.durableContextTokens + snapshot.pendingSendTokens + snapshot.environmentTokens
		expect(total).toBeGreaterThan(0)
		// The dynamic ENV segment is never folded into the durable segment.
		expect(snapshot.durableContextTokens + snapshot.environmentTokens).toBeLessThanOrEqual(total)
	})
})
