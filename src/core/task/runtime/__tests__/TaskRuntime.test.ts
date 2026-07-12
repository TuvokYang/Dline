import { describe, expect, it, vi } from "vitest"
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
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
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
	})

	it("returns a caller-visible failure when presenting an interaction fails", async () => {
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({
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
	})

	it("does not recurse when snapshot persistence fails", async () => {
		const persistSnapshot = vi.fn(async () => {
			throw new Error("snapshot failed")
		})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }),
			createPorts({ persistSnapshot }),
		)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({
			accepted: false,
			effectError: { effectType: "PERSIST_SNAPSHOT", message: "snapshot failed" },
		})
		expect(persistSnapshot).toHaveBeenCalledTimes(1)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.PAUSED,
			error: { effectType: "PERSIST_SNAPSHOT", message: "snapshot failed" },
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
