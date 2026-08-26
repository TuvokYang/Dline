import type { ProviderAttemptObserver } from "@shared/provider-attempt-observer"
import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"
import { Task } from "../index"
import type { ApiRequestRoundUsage } from "../performance/api-request-round-types"
import type { ProviderRequestRoundAdmission } from "../performance/provider-request-round-port"
import { TaskPhase } from "../TaskPhase"

interface ProviderExecutionBlock {
	readonly dlineTid: string
	readonly phase: BlockPhase
}

interface ProviderExecutionHarness {
	readonly activeProviderExecutionTurns: Map<
		ProviderRequestRoundAdmission,
		{ turnId: string; toolCount: number; turnEndInteractionIds: readonly string[] }
	>
	readonly turnEndProviderExecutions: Map<
		string,
		{ turnId: string; toolCount: number; admission: ProviderRequestRoundAdmission }
	>
	readonly taskController: { getBlocks(): readonly ProviderExecutionBlock[] }
	readonly taskRuntime: {
		getState(): {
			phase: TaskPhase
			turn?: { turnId: string; blocks: readonly ProviderExecutionBlock[] }
		}
	}
	readonly taskState: { abort: boolean }
}

interface RoundAdmissionHarness {
	readonly ordinaryProviderRequestRounds: Map<number, ProviderRequestRoundAdmission>
	readonly apiRequestRoundLifecycle: {
		createObserver(input: { logicalRequestId: string; apiIndex: number; taskAttempt: number }): ProviderAttemptObserver
		attachExactUsage(logicalRequestId: string, usage: ApiRequestRoundUsage): void
	}
	nextAuxiliaryProviderRoundApiIndex: number
}

const admitOrdinaryProviderRequestRound = Reflect.get(Task.prototype, "admitOrdinaryProviderRequestRound") as (
	this: RoundAdmissionHarness,
	apiIndex: number,
	taskAttempt: number,
) => ProviderRequestRoundAdmission

const completeProviderExecutionTurn = Reflect.get(Task.prototype, "completeProviderExecutionTurn") as (
	this: ProviderExecutionHarness,
	admission?: ProviderRequestRoundAdmission,
) => void

const completeProviderExecutionAtAwaitingUser = Reflect.get(Task.prototype, "completeProviderExecutionAtAwaitingUser") as (
	this: ProviderExecutionHarness,
	turnId: string,
	interactionId: string,
) => void

function createAdmission(): ProviderRequestRoundAdmission {
	return {
		bindAttempt: (stream) => stream,
		attachExactUsage: vi.fn(),
		completeProviderOnly: vi.fn(),
		completeTools: vi.fn(),
		completeTurnEndAwaitingUser: vi.fn(),
	}
}

function createProviderExecutionHarness(
	blocks: readonly ProviderExecutionBlock[],
	options: { readonly abort?: boolean; readonly phase?: TaskPhase; readonly turnId?: string } = {},
): ProviderExecutionHarness {
	const turnId = options.turnId ?? "turn:parallel"
	return Object.assign(Object.create(Task.prototype), {
		activeProviderExecutionTurns: new Map(),
		turnEndProviderExecutions: new Map(),
		taskController: { getBlocks: () => blocks },
		taskRuntime: {
			getState: () => ({ phase: options.phase ?? TaskPhase.BETWEEN_TURNS, turn: { turnId, blocks } }),
		},
		taskState: { abort: options.abort ?? false },
	}) as ProviderExecutionHarness
}

describe("Task Provider request round admission", () => {
	it("creates a new logical request for task attempt zero and reuses it only for recursive retries", () => {
		const observedScopes: Array<{ logicalRequestId: string; apiIndex: number; taskAttempt: number }> = []
		const attachedUsage: Array<{ logicalRequestId: string; usage: ApiRequestRoundUsage }> = []
		const observer: ProviderAttemptObserver<number> = {
			beginAttempt: () => 1,
			finishAttempt: () => undefined,
		}
		const harness = Object.assign(Object.create(Task.prototype), {
			ordinaryProviderRequestRounds: new Map<number, ProviderRequestRoundAdmission>(),
			nextAuxiliaryProviderRoundApiIndex: 0,
			apiRequestRoundLifecycle: {
				createObserver: vi.fn((input) => {
					observedScopes.push(input)
					return observer
				}),
				attachExactUsage: vi.fn((logicalRequestId, usage) => {
					attachedUsage.push({ logicalRequestId, usage })
				}),
			},
		}) as RoundAdmissionHarness
		const emptyStream = (async function* () {})()

		const first = admitOrdinaryProviderRequestRound.call(harness, 7, 0)
		const retry = admitOrdinaryProviderRequestRound.call(harness, 7, 1)
		expect(retry).toBe(first)
		first.bindAttempt(emptyStream, 0)
		retry.bindAttempt(emptyStream, 1)

		const restored = admitOrdinaryProviderRequestRound.call(harness, 7, 0)
		expect(restored).not.toBe(first)
		restored.bindAttempt(emptyStream, 0)

		const [firstScope, retryScope, restoredScope] = observedScopes
		expect(firstScope).toMatchObject({ apiIndex: 7, taskAttempt: 0 })
		expect(retryScope).toMatchObject({ apiIndex: 7, taskAttempt: 1 })
		expect(retryScope?.logicalRequestId).toBe(firstScope?.logicalRequestId)
		expect(restoredScope).toMatchObject({ apiIndex: 7, taskAttempt: 0 })
		expect(restoredScope?.logicalRequestId).not.toBe(firstScope?.logicalRequestId)

		const usage: ApiRequestRoundUsage = {
			inputTokens: 100,
			outputTokens: 20,
			cacheReadTokens: 0,
			cacheUsageReported: true,
		}
		harness.ordinaryProviderRequestRounds.get(7)?.attachExactUsage(usage)
		expect(attachedUsage).toEqual([{ logicalRequestId: restoredScope?.logicalRequestId, usage }])
	})

	it("completes a Provider-only execution when no tool turn was registered", () => {
		const admission = createAdmission()
		const harness = createProviderExecutionHarness([])

		completeProviderExecutionTurn.call(harness, admission)

		expect(admission.completeProviderOnly).toHaveBeenCalledOnce()
		expect(admission.completeTools).not.toHaveBeenCalled()
	})

	it("summarizes every terminal block in an all-settled parallel tool turn", () => {
		const admission = createAdmission()
		const blocks = [
			{ dlineTid: "completed", phase: BlockPhase.COMPLETED },
			{ dlineTid: "failed", phase: BlockPhase.REJECTED },
			{ dlineTid: "skipped", phase: BlockPhase.SKIPPED },
			{ dlineTid: "cancelled", phase: BlockPhase.CANCELLED },
		]
		const harness = createProviderExecutionHarness(blocks)
		harness.activeProviderExecutionTurns.set(admission, {
			turnId: "turn:parallel",
			toolCount: 4,
			turnEndInteractionIds: [],
		})

		completeProviderExecutionTurn.call(harness, admission)

		expect(admission.completeTools).toHaveBeenCalledWith({
			toolCount: 4,
			completedToolCount: 1,
			failedToolCount: 1,
			cancelledToolCount: 2,
		})
		expect(harness.activeProviderExecutionTurns.has(admission)).toBe(false)
	})

	it("leaves Task-aborted executions for lifecycle abort instead of writing tools-settled", () => {
		const admission = createAdmission()
		const harness = createProviderExecutionHarness([{ dlineTid: "tool", phase: BlockPhase.EXECUTING }], {
			abort: true,
		})
		harness.activeProviderExecutionTurns.set(admission, {
			turnId: "turn:parallel",
			toolCount: 1,
			turnEndInteractionIds: ["interaction-1"],
		})
		harness.turnEndProviderExecutions.set("interaction-1", {
			turnId: "turn:parallel",
			toolCount: 1,
			admission,
		})

		completeProviderExecutionTurn.call(harness, admission)

		expect(admission.completeProviderOnly).not.toHaveBeenCalled()
		expect(admission.completeTools).not.toHaveBeenCalled()
		expect(harness.activeProviderExecutionTurns.has(admission)).toBe(false)
		expect(harness.turnEndProviderExecutions.has("interaction-1")).toBe(false)
	})

	it("terminals TURN-END at the durable awaiting-user boundary without counting later user wait", () => {
		const admission = createAdmission()
		const blocks = [
			{ dlineTid: "regular", phase: BlockPhase.COMPLETED },
			{ dlineTid: "interaction-1", phase: BlockPhase.AWAITING_APPROVAL },
			{ dlineTid: "later", phase: BlockPhase.STREAMING },
		]
		const harness = createProviderExecutionHarness(blocks, { turnId: "turn:turn-end" })
		harness.turnEndProviderExecutions.set("interaction-1", {
			turnId: "turn:turn-end",
			toolCount: 3,
			admission,
		})

		completeProviderExecutionAtAwaitingUser.call(harness, "turn:turn-end", "interaction-1")
		completeProviderExecutionAtAwaitingUser.call(harness, "turn:turn-end", "interaction-1")

		expect(admission.completeTurnEndAwaitingUser).toHaveBeenCalledOnce()
		expect(admission.completeTurnEndAwaitingUser).toHaveBeenCalledWith({
			toolCount: 3,
			completedToolCount: 2,
			failedToolCount: 0,
			cancelledToolCount: 1,
		})
		expect(harness.turnEndProviderExecutions.has("interaction-1")).toBe(false)
	})
})
