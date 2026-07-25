import { describe, expect, it, vi } from "vitest"
import type { TaskEffectPorts } from "../../runtime/TaskEffectRunner"
import { TaskRuntime } from "../../runtime/TaskRuntime"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, hydrateSnapshot } from "../../TaskSnapshot"
import type { InteractionKind } from "../Interaction"
import { InteractionCoordinator } from "../InteractionCoordinator"
import type { InteractionResponse } from "../InteractionResponse"

/** Create no-op runtime ports for coordinator tests. */
function createPorts(overrides: Partial<TaskEffectPorts> = {}): TaskEffectPorts {
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

/** Recreate the exact crash window after response persistence and before continuation commit. */
function hydrateResolvingInteraction(input: {
	kind: InteractionKind
	phase: TaskPhase
	turnId: string
	interactionId: string
	response: InteractionResponse
	apiIndex?: number
}) {
	const state = {
		...createTaskRuntimeState({
			taskId: "task-1",
			phase: input.phase,
			revision: input.response.stateRevision + 1,
			anchor: { apiIndex: input.apiIndex ?? -1, turnId: input.turnId, interactionId: input.interactionId },
		}),
		interaction: {
			taskId: "task-1",
			turnId: input.turnId,
			interactionId: input.interactionId,
			kind: input.kind,
			status: "resolving" as const,
			createdRevision: input.response.stateRevision,
			anchor: { messageTs: 100, messageType: "ask" as const },
			acceptedResponse: input.response,
		},
	}
	return hydrateSnapshot(createSnapshot(state))
}

describe("InteractionCoordinator", () => {
	it("waits for one causal response and resolves the active interaction", async () => {
		const runtime = new TaskRuntime(createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }), createPorts())
		const coordinator = new InteractionCoordinator(runtime)

		const outcomePromise = coordinator.open({
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			presentation: JSON.stringify({ response: "Answer" }),
			existingTs: 100,
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))
		const revision = runtime.getState().revision

		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "reply",
				stateRevision: revision,
				draft: { text: "Continue", images: ["image-1"], files: ["file-1"] },
			},
		})

		await expect(outcomePromise).resolves.toEqual({
			actionId: "reply",
			draft: { text: "Continue", images: ["image-1"], files: ["file-1"] },
			selection: undefined,
		})
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("continues a generic handler from a hydrated resolving response without waiting again", async () => {
		const interactionId = "qna-crash"
		const turnId = "qna-turn"
		const response: InteractionResponse = {
			taskId: "task-1",
			turnId,
			interactionId,
			actionId: "reply",
			stateRevision: 4,
			draft: { text: "Recovered", images: [], files: [] },
		}
		const runtime = new TaskRuntime(
			hydrateResolvingInteraction({ kind: "qna_response", phase: TaskPhase.STREAMING, turnId, interactionId, response }),
			createPorts(),
		)

		await expect(
			new InteractionCoordinator(runtime).open({
				turnId,
				interactionId,
				kind: "qna_response",
				presentation: "Question",
			}),
		).resolves.toMatchObject({ actionId: "reply", draft: response.draft })
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("continues resume from a hydrated resolving response without duplicate user input", async () => {
		const interactionId = "resume-crash"
		const turnId = "resume-turn"
		const response: InteractionResponse = {
			taskId: "task-1",
			turnId,
			interactionId,
			actionId: "resume",
			stateRevision: 4,
			draft: { text: "Continue", images: [], files: [] },
		}
		const runtime = new TaskRuntime(
			hydrateResolvingInteraction({ kind: "resume", phase: TaskPhase.PAUSED, turnId, interactionId, response }),
			createPorts(),
		)

		await expect(new InteractionCoordinator(runtime).resumeExisting(interactionId)).resolves.toMatchObject({
			actionId: "resume",
		})
		expect(runtime.getState().phase).toBe(TaskPhase.RESUMING)
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("continues completion from a hydrated resolving response exactly once", async () => {
		const interactionId = "completion-crash"
		const turnId = "completion-turn"
		const response: InteractionResponse = {
			taskId: "task-1",
			turnId,
			interactionId,
			actionId: "reply",
			stateRevision: 4,
			draft: { text: "Refine", images: [], files: [] },
		}
		const state = hydrateResolvingInteraction({
			kind: "completion",
			phase: TaskPhase.COMPLETED,
			turnId,
			interactionId,
			response,
		})
		state.completion = { completionId: interactionId }
		const runtime = new TaskRuntime(state, createPorts())

		await expect(
			new InteractionCoordinator(runtime).complete({
				turnId,
				interactionId,
				completionId: interactionId,
				presentation: "Done",
			}),
		).resolves.toMatchObject({ actionId: "reply", draft: response.draft })
		expect(runtime.getState().phase).toBe(TaskPhase.STREAMING)
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("continues exhausted retry from a hydrated resolving response exactly once", async () => {
		const interactionId = "retry-crash"
		const turnId = "retry-turn"
		const response: InteractionResponse = {
			taskId: "task-1",
			turnId,
			interactionId,
			actionId: "retry",
			stateRevision: 4,
			draft: { text: "Retry context", images: [], files: [] },
		}
		const startApi = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			hydrateResolvingInteraction({
				kind: "error_retry",
				phase: TaskPhase.AWAITING_APPROVAL,
				turnId,
				interactionId,
				response,
				apiIndex: 7,
			}),
			createPorts({ startApi }),
		)

		await expect(
			new InteractionCoordinator(runtime).recover({ turnId, interactionId, apiIndex: 7, presentation: "Failed" }),
		).resolves.toMatchObject({ actionId: "retry", draft: response.draft })
		expect(startApi).toHaveBeenCalledOnce()
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.STREAMING, interaction: undefined })
	})

	it("commits a live resume response even when no waiter owns the interaction", async () => {
		const startApi = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({
					taskId: "task-1",
					phase: TaskPhase.PAUSED,
					revision: 4,
					anchor: { apiIndex: 2, turnId: "resume-turn", interactionId: "resume-1" },
				}),
				interaction: {
					taskId: "task-1",
					turnId: "resume-turn",
					interactionId: "resume-1",
					kind: "resume",
					status: "awaiting",
					createdRevision: 3,
					anchor: { messageTs: 100, messageType: "ask" },
				},
			},
			createPorts({ startApi }),
		)
		const coordinator = new InteractionCoordinator(runtime)

		await coordinator.respond({
			taskId: "task-1",
			turnId: "resume-turn",
			interactionId: "resume-1",
			actionId: "resume",
			stateRevision: runtime.getState().revision,
			draft: { text: "Continue", images: [], files: [] },
		})
		await vi.waitFor(() => {
			expect(runtime.getState().phase).toBe(TaskPhase.RESUMING)
			expect(runtime.getState().interaction).toBeUndefined()
			expect(startApi).toHaveBeenCalledOnce()
		})
	})

	it("commits one hydrated resume response exactly once without rejecting the waiter continuation", async () => {
		const startApi = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({
					taskId: "task-1",
					phase: TaskPhase.PAUSED,
					revision: 4,
					anchor: { apiIndex: 2, turnId: "resume-turn", interactionId: "resume-1" },
				}),
				interaction: {
					taskId: "task-1",
					turnId: "resume-turn",
					interactionId: "resume-1",
					kind: "resume",
					status: "awaiting",
					createdRevision: 3,
					anchor: { messageTs: 100, messageType: "ask" },
				},
			},
			createPorts({ startApi }),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const resumePromise = coordinator.resumeExisting("resume-1")
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))

		const responseResult = await coordinator.respond({
			taskId: "task-1",
			turnId: "resume-turn",
			interactionId: "resume-1",
			actionId: "resume",
			stateRevision: runtime.getState().revision,
			draft: { text: "Continue", images: [], files: [] },
		})
		await expect(resumePromise).resolves.toMatchObject({ actionId: "resume" })

		expect(responseResult.accepted).toBe(true)
		expect(responseResult.effectError).toBeUndefined()
		expect(startApi).toHaveBeenCalledOnce()
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.RESUMING, interaction: undefined })
	})

	it("takes over one hydrated resume interaction and commits its causal response", async () => {
		const runtime = new TaskRuntime(
			{
				...createTaskRuntimeState({
					taskId: "task-1",
					phase: TaskPhase.PAUSED,
					revision: 4,
					anchor: { apiIndex: 2, turnId: "resume-turn", interactionId: "resume-1" },
				}),
				interaction: {
					taskId: "task-1",
					turnId: "resume-turn",
					interactionId: "resume-1",
					kind: "resume",
					status: "awaiting",
					createdRevision: 3,
					anchor: { messageTs: 100, messageType: "ask" },
				},
			},
			createPorts(),
		)
		const coordinator = new InteractionCoordinator(runtime)

		const outcomePromise = coordinator.resumeExisting("resume-1")
		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "resume-turn",
				interactionId: "resume-1",
				actionId: "resume",
				stateRevision: runtime.getState().revision,
				draft: { text: "Continue", images: [], files: [] },
			},
		})

		await expect(outcomePromise).resolves.toMatchObject({ actionId: "resume" })
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.RESUMING })
		expect(runtime.getState().interaction).toBeUndefined()
		expect(runtime.getState().anchor.interactionId).toBeUndefined()
	})

	it("commits completion feedback before returning it to the handler", async () => {
		const runtime = new TaskRuntime(createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.EXECUTING }), createPorts())
		const coordinator = new InteractionCoordinator(runtime)

		const outcomePromise = coordinator.complete({
			turnId: "turn-completion",
			interactionId: "completion-1",
			completionId: "completion-1",
			presentation: "done",
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))

		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-completion",
				interactionId: "completion-1",
				actionId: "reply",
				stateRevision: runtime.getState().revision,
				draft: { text: "Refine", images: [], files: [] },
			},
		})

		await expect(outcomePromise).resolves.toMatchObject({ actionId: "reply" })
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.STREAMING })
		expect(runtime.getState().interaction).toBeUndefined()
		expect(runtime.getState().completion).toBeUndefined()
	})

	it("commits start-new-task effect before returning terminal completion", async () => {
		const startNewTask = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.EXECUTING }),
			createPorts({ startNewTask }),
		)
		const coordinator = new InteractionCoordinator(runtime)

		const outcomePromise = coordinator.complete({
			turnId: "turn-completion",
			interactionId: "completion-1",
			completionId: "completion-1",
			presentation: "done",
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))

		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-completion",
				interactionId: "completion-1",
				actionId: "start_new_task",
				stateRevision: runtime.getState().revision,
				draft: { text: "Next", images: [], files: [] },
			},
		})

		await expect(outcomePromise).resolves.toMatchObject({ actionId: "start_new_task" })
		expect(startNewTask).toHaveBeenCalledOnce()
		expect(runtime.getState().phase).toBe(TaskPhase.COMPLETED)
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("commits retry draft through one START_API continuation", async () => {
		const startApi = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, anchor: { apiIndex: 7 } }),
			createPorts({ startApi }),
		)
		const coordinator = new InteractionCoordinator(runtime)

		const outcomePromise = coordinator.recover({
			turnId: "turn-retry",
			interactionId: "retry-1",
			apiIndex: 7,
			presentation: "failed",
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))

		await runtime.dispatch({
			type: "INTERACTION_RESPONDED",
			response: {
				taskId: "task-1",
				turnId: "turn-retry",
				interactionId: "retry-1",
				actionId: "retry",
				stateRevision: runtime.getState().revision,
				draft: { text: "context", images: ["image"], files: ["file"] },
			},
		})

		await expect(outcomePromise).resolves.toMatchObject({ actionId: "retry" })
		expect(startApi).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "START_API",
				apiIndex: 7,
				draft: { text: "context", images: ["image"], files: ["file"] },
			}),
		)
		expect(runtime.getState().phase).toBe(TaskPhase.STREAMING)
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("rejects a second primary interaction while one is active", async () => {
		const runtime = new TaskRuntime(createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING }), createPorts())
		const coordinator = new InteractionCoordinator(runtime)
		void coordinator.open({
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			presentation: "First",
		})
		await vi.waitFor(() => expect(runtime.getState().interaction?.status).toBe("awaiting"))

		await expect(
			coordinator.open({
				turnId: "turn-1",
				interactionId: "interaction-2",
				kind: "followup",
				presentation: "Second",
			}),
		).rejects.toThrow("Interaction open rejected")
	})
})
