import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { InteractionCoordinator, type InteractionOutcome } from "../../interaction/InteractionCoordinator"
import { TaskPhase } from "../../TaskPhase"
import type { TaskEffectPorts } from "../TaskEffectRunner"
import { TaskRuntime } from "../TaskRuntime"
import { createTaskRuntimeState } from "../TaskRuntimeState"

/** Create no-op ports that focused tests can override. */
function createPorts(overrides: Partial<TaskEffectPorts> = {}): TaskEffectPorts {
	return {
		postView: async () => {},
		persistSnapshot: async () => {},
		cancelRuntime: async () => {},
		startApi: async () => {},
		executeTool: async () => {},
		appendSay: async () => {},
		appendAsk: async () => ({ uiMessageTs: 1 }),
		startNewTask: async () => {},
		...overrides,
	}
}

describe("TaskRuntime dispatch", () => {
	it("allows an executing tool to open a nested interaction without self-deadlocking", async () => {
		let runtime: TaskRuntime
		let coordinator: InteractionCoordinator
		let outcome: InteractionOutcome | undefined
		runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
				turn: {
					turnId: "turn-1",
					assistantApiIndex: 1,
					mode: "parallel",
					blocks: [
						{
							dlineTid: "tid-qna",
							functionId: "call-qna",
							toolName: "qna_respond",
							ts: 10,
							requiresApproval: false,
							conversationHistoryIndex: 1,
							phase: BlockPhase.AUTO_EXECUTING,
						},
					],
				},
			},
			createPorts({
				executeTool: async () => {
					outcome = await coordinator.open({
						turnId: "turn-1",
						interactionId: "tid-qna",
						kind: "qna_response",
						presentation: "Answer",
						existingTs: 10,
					})
				},
			}),
		)
		coordinator = new InteractionCoordinator(runtime)

		const execution = runtime.dispatch({
			type: "BLOCK_EXECUTION_STARTED",
			turnId: "turn-1",
			dlineTid: "tid-qna",
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))
		const awaiting = runtime.getState()
		const response = await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "tid-qna",
				actionId: "reply",
				stateRevision: awaiting.revision,
				draft: { text: "continue", images: [], files: [] },
			},
		})
		const result = await execution

		expect(result.accepted).toBe(true)
		expect(response.accepted).toBe(true)
		expect(outcome).toMatchObject({ actionId: "reply", draft: { text: "continue" } })
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.EXECUTING,
			interaction: undefined,
		})
	})

	it("allows a resumed API effect to dispatch its request lifecycle without self-deadlocking", async () => {
		let runtime: TaskRuntime
		let nestedAccepted = false
		runtime = new TaskRuntime(
			createTaskRuntimeState({
				taskId: "task-1",
				phase: TaskPhase.STREAMING,
				anchor: { apiIndex: 2 },
			}),
			createPorts({
				startApi: async (effect) => {
					const nested = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: effect.apiIndex })
					nestedAccepted = nested.accepted
				},
			}),
		)

		const result = await runtime.dispatch({ type: "RESUME_API_CONTINUATION_REQUESTED", apiIndex: 2 })

		expect(result.accepted).toBe(true)
		expect(nestedAccepted).toBe(true)
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.STREAMING, anchor: { apiIndex: 2 } })
	})

	it("commits next state before running effects in order", async () => {
		const order: string[] = []
		let runtime: TaskRuntime
		runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
				postView: async () => {
					order.push(`view:${runtime.getState().phase}`)
				},
				cancelRuntime: async () => {
					order.push("cancel")
				},
				persistSnapshot: async () => {
					order.push("snapshot")
				},
			}),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result.accepted).toBe(true)
		expect(order).toEqual(["view:cancelling", "cancel", "snapshot"])
	})

	it("serializes concurrent dispatches", async () => {
		const order: string[] = []
		let releaseCancel: (() => void) | undefined
		const cancelBarrier = new Promise<void>((resolve) => {
			releaseCancel = resolve
		})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
				postView: async () => {
					order.push("view")
				},
				cancelRuntime: async () => {
					order.push("cancel:start")
					await cancelBarrier
					order.push("cancel:end")
				},
				persistSnapshot: async () => {
					order.push("snapshot")
				},
			}),
		)

		const cancel = runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })
		const cancelled = runtime.dispatch({ type: "TASK_CANCELLED" })
		await vi.waitFor(() => expect(order).toContain("cancel:start"))
		expect(runtime.getState().phase).toBe(TaskPhase.CANCELLING)
		releaseCancel?.()
		await Promise.all([cancel, cancelled])

		expect(runtime.getState().phase).toBe(TaskPhase.PAUSED)
		expect(order).toEqual(["view", "cancel:start", "cancel:end", "snapshot", "view", "snapshot"])
	})

	it("commits an ask anchor returned by the append effect", async () => {
		const appendAsk = vi.fn(async () => ({ uiMessageTs: 100 }))
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({ appendAsk }),
		)

		const result = await runtime.dispatch({
			type: "INTERACTION_OPEN_REQUESTED",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			presentation: JSON.stringify({ response: "Answer" }),
			existingTs: 100,
		})

		expect(result.accepted).toBe(true)
		expect(appendAsk).toHaveBeenCalledWith(
			expect.objectContaining({ interactionId: "interaction-1", taskAsk: "qna_respond", existingTs: 100 }),
		)
		expect(runtime.getState()).toMatchObject({
			revision: 2,
			interaction: {
				interactionId: "interaction-1",
				status: "awaiting",
				anchor: { messageTs: 100, messageType: "ask" },
			},
		})
	})

	it("notifies observers after a causal response is committed", async () => {
		const observed: string[] = []
		const runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.AWAITING_APPROVAL, revision: 4 }),
				interaction: {
					taskId: "task-1",
					turnId: "turn-1",
					interactionId: "interaction-1",
					kind: "tool_approval",
					status: "awaiting",
					createdRevision: 4,
					anchor: { messageTs: 100, messageType: "ask" },
				},
			},
			createPorts(),
		)
		const unsubscribe = runtime.subscribe((event, result) => {
			if (event.type === "INTERACTION_RESPONDED" && result.accepted) {
				observed.push(event.response.actionId)
			}
		})

		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 4,
				draft: { text: "", images: [], files: [] },
			},
		})
		unsubscribe()

		expect(observed).toEqual(["approve"])
	})

	it("returns a caller-visible failure when cancellation effects fail", async () => {
		const postView = vi.fn(async () => {})
		const persistSnapshot = vi.fn(async () => {})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
				postView,
				persistSnapshot,
				cancelRuntime: async () => {
					throw new Error("cancel failed")
				},
			}),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({
			accepted: false,
			effectError: { effectType: "CANCEL_RUNTIME", message: "cancel failed" },
		})
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.PAUSED,
			error: { effectType: "CANCEL_RUNTIME", message: "cancel failed" },
		})
		expect(postView).toHaveBeenCalledTimes(2)
		expect(persistSnapshot).toHaveBeenCalledTimes(1)
	})

	it("returns a caller-visible failure when presenting an interaction fails", async () => {
		const postView = vi.fn(async () => {})
		const persistSnapshot = vi.fn(async () => {})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
				postView,
				persistSnapshot,
				appendAsk: async () => {
					throw new Error("ask failed")
				},
			}),
		)

		const result = await runtime.dispatch({
			type: "INTERACTION_OPEN_REQUESTED",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			presentation: "Answer",
		})

		expect(result).toMatchObject({
			accepted: false,
			effectError: { effectType: "APPEND_ASK", message: "ask failed" },
		})
		expect(runtime.getState().phase).toBe(TaskPhase.PAUSED)
		expect(postView).toHaveBeenCalledTimes(1)
		expect(persistSnapshot).toHaveBeenCalledTimes(1)
	})

	it("does not recurse when snapshot persistence fails", async () => {
		const postView = vi.fn(async () => {})
		const persistSnapshot = vi.fn(async () => {
			throw new Error("snapshot failed")
		})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({ postView, persistSnapshot }),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({
			accepted: false,
			effectError: { effectType: "PERSIST_SNAPSHOT", message: "snapshot failed" },
		})
		expect(persistSnapshot).toHaveBeenCalledTimes(1)
		expect(postView).toHaveBeenCalledTimes(2)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.PAUSED,
			error: { effectType: "PERSIST_SNAPSHOT", message: "snapshot failed" },
		})
	})

	it("persists recovery without retrying a failed view projection", async () => {
		const postView = vi.fn(async () => {
			throw new Error("view failed")
		})
		const persistSnapshot = vi.fn(async () => {})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({ postView, persistSnapshot }),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({
			accepted: false,
			effectError: { effectType: "POST_TASK_VIEW", message: "view failed" },
		})
		expect(postView).toHaveBeenCalledTimes(1)
		expect(persistSnapshot).toHaveBeenCalledTimes(1)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.PAUSED,
			error: { effectType: "POST_TASK_VIEW", message: "view failed" },
		})
	})

	it("does not run effects for a rejected event", async () => {
		const postView = vi.fn(async () => {})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.IDLE }),
			createPorts({ postView }),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({ accepted: false, error: { code: "invalid_runtime_event" } })
		expect(postView).not.toHaveBeenCalled()
		expect(runtime.getState().phase).toBe(TaskPhase.IDLE)
	})
})
