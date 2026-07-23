import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { Task } from "../../index"
import type { InteractionKind } from "../../interaction/Interaction"
import { InteractionCoordinator, type InteractionOutcome } from "../../interaction/InteractionCoordinator"
import type { InteractionResponse } from "../../interaction/InteractionResponse"
import type { TaskEffectPorts } from "../../runtime/TaskEffectRunner"
import { TaskRuntime } from "../../runtime/TaskRuntime"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, hydrateSnapshot } from "../../TaskSnapshot"
import { projectTaskView } from "../../view/TaskViewProjector"
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
		publishView: vi.fn(async () => {
			order.push("publishView")
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
		publishView: async () => undefined,
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
		expect(order).toEqual(["load", "persist", "hydrate:streaming", "publishView", "dispatch:continue_api_turn"])
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
						functionId: "function-1",
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
		expect(order).toEqual(["load", "persist", "hydrate:read_only", "publishView", "dispatch:read_only_failure"])
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

	it("publishes a legacy completed interaction as Start New Task instead of Resume", async () => {
		const taskId = "1784572948814"
		const turnId = "turn:dline_tid_01KY27BMZJ3NK3WF475VNJEJXB"
		const completionId = "dline_tid_01KY27BMZJ3NK3WF475VNJEJXB"
		const messageTs = 1784633742323
		const legacyState = createTaskRuntimeState({
			taskId,
			phase: TaskPhase.COMPLETED,
			revision: 214,
			anchor: { apiIndex: 143, turnId, uiMessageTs: messageTs, interactionId: completionId },
		})
		legacyState.turn = {
			turnId,
			assistantApiIndex: 144,
			mode: "parallel",
			blocks: [
				{
					dlineTid: completionId,
					functionId: "call_ntLbQcg5Bgc8HsOQggBTYT2W",
					toolName: "attempt_completion",
					ts: messageTs,
					requiresApproval: false,
					conversationHistoryIndex: 0,
					phase: BlockPhase.AUTO_EXECUTING,
				},
			],
		}
		legacyState.completion = { completionId }
		const legacySnapshot = createSnapshot(legacyState, 1784633974188)
		legacySnapshot.phase = TaskPhase.CANCELLING
		legacySnapshot.cancellation = { source: "system", fromPhase: TaskPhase.COMPLETED }
		legacySnapshot.interaction = undefined
		const resumeInput: ResumeInput = {
			taskId,
			snapshot: legacySnapshot,
			uiTail: [],
			apiTail: [],
			apiHistoryLength: 145,
		}
		const publishedViews: ReturnType<typeof projectTaskView>[] = []
		const runtime = new TaskRuntime(createTaskRuntimeState({ taskId }), runtimePorts())
		const coordinator = new ResumeCoordinator({
			load: async () => resumeInput,
			persist: async () => undefined,
			hydrate: async (result) => runtime.restore(hydrateSnapshot(result.snapshot)),
			publishView: async () => {
				publishedViews.push(projectTaskView(runtime.getState()))
			},
			dispatch: async () => undefined,
		})

		const result = await coordinator.resume(taskId)

		expect(result.entry).toEqual({ type: "show_completion_interaction", interactionId: completionId, turnId })
		expect(publishedViews[0]?.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(publishedViews[0]?.footer.actions.map((action) => action.type)).toEqual(["start_new_task"])
	})

	it("publishes the hydrated completed interaction before waiting for input", async () => {
		const resumeInput = resolvingInput({ kind: "completion", phase: TaskPhase.COMPLETED, actionId: "reply" })
		if (!resumeInput.snapshot.interaction) throw new Error("completion_interaction_missing")
		resumeInput.snapshot.interaction = {
			...resumeInput.snapshot.interaction,
			status: "awaiting",
			acceptedResponse: undefined,
		}
		const publishedViews: ReturnType<typeof projectTaskView>[] = []
		const postView = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(createTaskRuntimeState({ taskId: "task-1" }), runtimePorts({ postView }))
		const coordinator = new ResumeCoordinator({
			load: async () => resumeInput,
			persist: async () => undefined,
			hydrate: async (result) => runtime.restore(hydrateSnapshot(result.snapshot)),
			publishView: async () => {
				publishedViews.push(projectTaskView(runtime.getState()))
				await postView()
			},
			dispatch: async () => undefined,
		})

		await coordinator.resume("task-1")

		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.COMPLETED,
			interaction: { kind: "completion", status: "awaiting" },
		})
		expect(postView).toHaveBeenCalledOnce()
		expect(publishedViews[0]?.footer.actions.map((action) => action.type)).toEqual(["start_new_task"])
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

	it("routes production reopen_interaction through one handler continuation and provider request", async () => {
		const outcome = {
			actionId: "reply" as const,
			draft: { text: "continue", images: [], files: [] },
		}
		const open = vi.fn(async () => outcome)
		const continueTurnEndInteraction = vi.fn(async () => "continued tool result")
		const recursivelyMakeClineRequests = vi.fn(async () => false)
		const block = {
			type: "tool_use" as const,
			name: "qna_respond",
			params: { response: "answer" },
			partial: false,
			ts: 100,
			function_id: "function-handler",
			dline_tid: "handler-interaction",
		}
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
						anchor: { messageTs: 100, messageType: "ask" as const },
					},
				}),
			},
			interactionCoordinator: { open },
			toolExecutor: { continueTurnEndInteraction },
			taskState: { assistantMessageContent: [block], userMessageContent: [] },
			messageStateHandler: { apiConversationHistory: [] },
			restoreHandler: { storedToRuntime: vi.fn() },
			recursivelyMakeClineRequests,
			findRestoredTurnEndBlock: (
				Task.prototype as unknown as { findRestoredTurnEndBlock(interactionId: string, messageTs: number): typeof block }
			).findRestoredTurnEndBlock,
			continueRestoredTurnEnd: (
				Task.prototype as unknown as {
					continueRestoredTurnEnd(
						kind: InteractionKind,
						interactionId: string,
						messageTs: number,
						outcome: InteractionOutcome,
					): Promise<void>
				}
			).continueRestoredTurnEnd,
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
		expect(continueTurnEndInteraction).toHaveBeenCalledOnce()
		expect(continueTurnEndInteraction).toHaveBeenCalledWith("qna_response", block, outcome)
		expect(recursivelyMakeClineRequests).toHaveBeenCalledOnce()
		expect(recursivelyMakeClineRequests).toHaveBeenCalledWith([
			expect.objectContaining({
				type: "tool_result",
				function_id: "function-handler",
				dline_tid: "handler-interaction",
			}),
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("session was closed"),
			}),
		])
	})

	it.each([
		["reply", 1],
		["start_new_task", 0],
	] as const)("routes restored completion %s without replaying command side effects", async (actionId, continuationCount) => {
		const outcome = {
			actionId,
			draft: { text: actionId === "reply" ? "continue" : "", images: [], files: [] },
		}
		const complete = vi.fn(async () => outcome)
		const continueRestoredTurnEnd = vi.fn(async () => undefined)
		const commandExecutor = { execute: vi.fn() }
		const route = (Task.prototype as unknown as { dispatchResumeEntry(entry: ResumeEntry): Promise<void> })
			.dispatchResumeEntry
		const fakeTask = {
			taskRuntime: {
				getState: () => ({
					completion: { completionId: "completion-interaction" },
					interaction: {
						interactionId: "completion-interaction",
						turnId: "completion-turn",
						kind: "completion" as const,
						status: "resolving" as const,
						anchor: { messageTs: 100, messageType: "ask" as const },
					},
				}),
			},
			interactionCoordinator: { complete },
			continueRestoredTurnEnd,
			commandExecutor,
			dispatchResumeEntry: route,
		} as unknown as Task

		await route.call(fakeTask, {
			type: "show_completion_interaction",
			interactionId: "completion-interaction",
			turnId: "completion-turn",
		})

		expect(complete).toHaveBeenCalledOnce()
		expect(continueRestoredTurnEnd).toHaveBeenCalledTimes(continuationCount)
		if (actionId === "reply") {
			expect(continueRestoredTurnEnd).toHaveBeenCalledWith("completion", "completion-interaction", 100, outcome)
		}
		expect(commandExecutor.execute).not.toHaveBeenCalled()
	})
})
