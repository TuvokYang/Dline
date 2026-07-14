import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { Task } from "../../index"
import type { InteractionKind } from "../../interaction/Interaction"
import { InteractionCoordinator } from "../../interaction/InteractionCoordinator"
import type { InteractionResponse } from "../../interaction/InteractionResponse"
import type { TaskEffectPorts } from "../../runtime/TaskEffectRunner"
import { TaskRuntime } from "../../runtime/TaskRuntime"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, hydrateSnapshot } from "../../TaskSnapshot"
import { ResumeCoordinator, type ResumeCoordinatorPorts } from "../ResumeCoordinator"
import type { ResumeEntry, ResumeInput, ResumeResult } from "../ResumeInput"

/** Build a strict resumable input without any post-snapshot tail. */
function input(): ResumeInput {
	return {
		taskId: "task-1",
		snapshot: createSnapshot(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, revision: 3, anchor: { apiIndex: 2 } }),
			100,
		),
		uiTail: [],
		apiTail: [],
		apiHistoryLength: 3,
	}
}

/** Create observable coordinator ports. */
function ports(order: string[]): ResumeCoordinatorPorts {
	return {
		load: vi.fn(async () => {
			order.push("load")
			return input()
		}),
		persist: vi.fn(async () => {
			order.push("persist")
		}),
		hydrate: vi.fn(async (result) => {
			order.push(
				result.entry.type === "read_only_failure"
					? "hydrate:read_only"
					: `hydrate:${hydrateSnapshot(result.snapshot).phase}`,
			)
		}),
		dispatch: vi.fn(async (entry: ResumeEntry) => {
			order.push(`dispatch:${entry.type}`)
		}),
	}
}

/** Create one strict crash-window snapshot after response persistence and before continuation commit. */
function resolvingInput(input: {
	kind: InteractionKind
	phase: TaskPhase
	actionId: InteractionResponse["actionId"]
	apiIndex?: number
}): ResumeInput {
	const turnId = `${input.kind}-turn`
	const interactionId = `${input.kind}-interaction`
	const response: InteractionResponse = {
		taskId: "task-1",
		turnId,
		interactionId,
		actionId: input.actionId,
		stateRevision: 4,
		draft: { text: `${input.kind} continuation`, images: [], files: [] },
	}
	const state = {
		...createTaskRuntimeState({
			taskId: "task-1",
			phase: input.phase,
			revision: 5,
			anchor: { apiIndex: input.apiIndex ?? 2, turnId, interactionId },
		}),
		interaction: {
			taskId: "task-1",
			turnId,
			interactionId,
			kind: input.kind,
			status: "resolving" as const,
			createdRevision: 3,
			anchor: { messageTs: 100, messageType: "ask" as const },
			acceptedResponse: response,
		},
		...(input.kind === "completion" ? { completion: { completionId: interactionId } } : {}),
	}
	return {
		taskId: "task-1",
		snapshot: createSnapshot(state, 100),
		uiTail: [],
		apiTail: [],
		apiHistoryLength: (input.apiIndex ?? 2) + 1,
	}
}

/** Create observable runtime ports for exact-once continuation assertions. */
function runtimePorts(overrides: Partial<TaskEffectPorts> = {}): TaskEffectPorts {
	return {
		postView: async () => {},
		persistSnapshot: async () => {},
		cancelRuntime: async () => {},
		startApi: async () => {},
		executeTool: async () => {},
		appendSay: async () => {},
		appendAsk: async () => ({ uiMessageTs: 100 }),
		startNewTask: async () => {},
		...overrides,
	}
}

/** Run the production resume transaction shape with real runtime continuation dispatch. */
async function runResolvingTransaction(resumeInput: ResumeInput, effectPorts: TaskEffectPorts = runtimePorts()) {
	const runtime = new TaskRuntime(createTaskRuntimeState({ taskId: "task-1" }), effectPorts)
	const interactions = new InteractionCoordinator(runtime)
	const persisted: ResumeResult[] = []
	const dispatched: ResumeEntry[] = []
	const coordinator = new ResumeCoordinator({
		load: async () => resumeInput,
		persist: async (result) => {
			persisted.push(result)
		},
		hydrate: async (result) => {
			runtime.restore(hydrateSnapshot(result.snapshot))
		},
		dispatch: async (entry) => {
			dispatched.push(entry)
			switch (entry.type) {
				case "reopen_interaction": {
					const interaction = runtime.getState().interaction
					if (!interaction) throw new Error("hydrated_interaction_missing")
					await interactions.open({
						turnId: entry.turnId,
						interactionId: entry.interactionId,
						kind: interaction.kind,
						presentation: "",
					})
					return
				}
				case "show_completion_interaction":
					await interactions.complete({
						turnId: entry.turnId,
						interactionId: entry.interactionId,
						completionId: entry.interactionId,
						presentation: "",
					})
					return
				case "show_error_recovery":
					await interactions.recover({
						turnId: entry.turnId,
						interactionId: entry.interactionId,
						apiIndex: entry.apiIndex,
						presentation: "",
					})
					return
				case "show_resume_interaction":
					if (!entry.interactionId) throw new Error("resume_interaction_identity_missing")
					await interactions.resumeExisting(entry.interactionId)
					return
				default:
					throw new Error(`unexpected_resume_entry:${entry.type}`)
			}
		},
	})

	const result = await coordinator.resume("task-1")
	return { result, runtime, persisted, dispatched }
}

describe("ResumeCoordinator", () => {
	it("runs the exact load-reconcile-persist-hydrate-dispatch order", async () => {
		const order: string[] = []
		const coordinator = new ResumeCoordinator(ports(order))

		const result = await coordinator.resume("task-1")

		expect(result.entry).toEqual({ type: "continue_api_turn", apiIndex: 2 })
		expect(order).toEqual(["load", "persist", "hydrate:streaming", "dispatch:continue_api_turn"])
	})

	it("dispatches missing-identity diagnostics even when the snapshot cannot hydrate", async () => {
		const order: string[] = []
		const coordinatorPorts = ports(order)
		coordinatorPorts.load = vi.fn(async () => {
			order.push("load")
			const value = input()
			value.snapshot.turn = {
				turnId: "turn-1",
				assistantApiIndex: 2,
				mode: "serial",
				blocks: [
					{
						dlineTid: "",
						callId: "call-1",
						toolName: "read_file",
						phase: BlockPhase.EXECUTING,
						ts: 90,
						requiresApproval: false,
						conversationHistoryIndex: 2,
					},
				],
			}
			return value
		})
		const coordinator = new ResumeCoordinator(coordinatorPorts)

		const result = await coordinator.resume("task-1")

		expect(result.diagnostics).toEqual([{ code: "missing_identity", field: "dlineTid" }])
		expect(coordinatorPorts.persist).toHaveBeenCalledWith(expect.objectContaining({ entry: { type: "read_only_failure" } }))
		expect(coordinatorPorts.dispatch).toHaveBeenCalledWith({
			type: "read_only_failure",
			diagnostics: [{ code: "missing_identity", field: "dlineTid" }],
		})
	})

	it("persists and dispatches read-only failure diagnostics without guessing", async () => {
		const order: string[] = []
		const coordinatorPorts = ports(order)
		coordinatorPorts.load = vi.fn(async () => {
			order.push("load")
			const value = input()
			value.snapshot.anchor = { apiIndex: -2 }
			return value
		})
		const coordinator = new ResumeCoordinator(coordinatorPorts)

		const result = await coordinator.resume("task-1")

		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toEqual([{ code: "corrupt_anchor", field: "apiIndex" }])
		expect(order).toEqual(["load", "persist", "hydrate:read_only", "dispatch:read_only_failure"])
		expect(coordinatorPorts.dispatch).toHaveBeenCalledWith({
			type: "read_only_failure",
			diagnostics: [{ code: "corrupt_anchor", field: "apiIndex" }],
		})
	})

	it("continues a persisted resolving handler response exactly once", async () => {
		const transaction = await runResolvingTransaction(
			resolvingInput({ kind: "qna_response", phase: TaskPhase.STREAMING, actionId: "reply" }),
		)

		expect(transaction.result.entry).toEqual({
			type: "reopen_interaction",
			interactionId: "qna_response-interaction",
			turnId: "qna_response-turn",
		})
		expect(transaction.persisted).toHaveLength(1)
		expect(transaction.persisted[0]?.snapshot.interaction?.status).toBe("resolving")
		expect(transaction.dispatched).toEqual([transaction.result.entry])
		expect(transaction.runtime.getState().interaction).toBeUndefined()
	})

	it("continues a persisted resolving completion response exactly once", async () => {
		const transaction = await runResolvingTransaction(
			resolvingInput({ kind: "completion", phase: TaskPhase.COMPLETED, actionId: "reply" }),
		)

		expect(transaction.result.entry).toEqual({
			type: "show_completion_interaction",
			interactionId: "completion-interaction",
			turnId: "completion-turn",
		})
		expect(transaction.dispatched).toHaveLength(1)
		expect(transaction.runtime.getState().phase).toBe(TaskPhase.STREAMING)
		expect(transaction.runtime.getState().interaction).toBeUndefined()
	})

	it("continues a persisted resolving retry response through one API start", async () => {
		const startApi = vi.fn(async () => undefined)
		const transaction = await runResolvingTransaction(
			resolvingInput({ kind: "error_retry", phase: TaskPhase.AWAITING_APPROVAL, actionId: "retry", apiIndex: 7 }),
			runtimePorts({ startApi }),
		)

		expect(transaction.result.entry).toEqual({
			type: "show_error_recovery",
			interactionId: "error_retry-interaction",
			turnId: "error_retry-turn",
			apiIndex: 7,
		})
		expect(startApi).toHaveBeenCalledOnce()
		expect(transaction.dispatched).toHaveLength(1)
		expect(transaction.runtime.getState().interaction).toBeUndefined()
	})

	it("continues a persisted resolving resume response through one API start", async () => {
		const startApi = vi.fn(async () => undefined)
		const transaction = await runResolvingTransaction(
			resolvingInput({ kind: "resume", phase: TaskPhase.PAUSED, actionId: "resume", apiIndex: 4 }),
			runtimePorts({ startApi }),
		)

		expect(transaction.result.entry).toEqual({
			type: "show_resume_interaction",
			interactionId: "resume-interaction",
			turnId: "resume-turn",
		})
		expect(startApi).toHaveBeenCalledOnce()
		expect(transaction.dispatched).toHaveLength(1)
		expect(transaction.runtime.getState().phase).toBe(TaskPhase.RESUMING)
		expect(transaction.runtime.getState().interaction).toBeUndefined()
	})

	it("routes production reopen_interaction to the hydrated generic continuation", async () => {
		const open = vi.fn(async () => ({ actionId: "reply" as const }))
		const route = (Task.prototype as unknown as { dispatchResumeEntry(entry: ResumeEntry): Promise<void> })
			.dispatchResumeEntry
		const fakeTask = {
			taskRuntime: {
				getState: () => ({
					interaction: {
						interactionId: "handler-interaction",
						turnId: "handler-turn",
						kind: "qna_response" as const,
						status: "resolving" as const,
					},
				}),
			},
			interactionCoordinator: { open },
			dispatchResumeEntry: route,
		} as unknown as Task

		await route.call(fakeTask, {
			type: "reopen_interaction",
			interactionId: "handler-interaction",
			turnId: "handler-turn",
		})

		expect(open).toHaveBeenCalledOnce()
		expect(open).toHaveBeenCalledWith({
			turnId: "handler-turn",
			interactionId: "handler-interaction",
			kind: "qna_response",
			presentation: "",
		})
	})
})
