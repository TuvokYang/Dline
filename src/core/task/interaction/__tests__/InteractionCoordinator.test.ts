import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import type { TaskEffectPorts } from "../../runtime/TaskEffectRunner"
import { TaskRuntime } from "../../runtime/TaskRuntime"
import { createTaskRuntimeState, type TurnState } from "../../runtime/TaskRuntimeState"
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
		prepareResume: async () => {},
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

/** Recreate a stopped historical interaction before the user clicks its original action. */
function hydrateAwaitingInteraction(input: {
	kind: InteractionKind
	phase: TaskPhase
	turnId: string
	interactionId: string
	apiIndex?: number
	turn?: TurnState
}) {
	const state = {
		...createTaskRuntimeState({
			taskId: "task-1",
			phase: input.phase,
			revision: 5,
			anchor: {
				apiIndex: input.apiIndex ?? 2,
				uiMessageTs: 100,
				turnId: input.turnId,
				interactionId: input.interactionId,
			},
		}),
		...(input.turn ? { turn: input.turn } : {}),
		...(input.kind === "completion" ? { completion: { completionId: input.interactionId } } : {}),
		interaction: {
			taskId: "task-1",
			turnId: input.turnId,
			interactionId: input.interactionId,
			kind: input.kind,
			status: "awaiting" as const,
			createdRevision: 4,
			anchor: { messageTs: 100, messageType: "ask" as const },
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

	it("does not consume a detached handler response before Task registers its continuation", async () => {
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "qna_response",
				phase: TaskPhase.EXECUTING,
				turnId: "turn-qna",
				interactionId: "qna-1",
			}),
			createPorts(),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const revision = runtime.getState().revision

		await expect(
			coordinator.respond({
				taskId: "task-1",
				turnId: "turn-qna",
				interactionId: "qna-1",
				actionId: "reply",
				stateRevision: revision,
				draft: { text: "Answer", images: [], files: [] },
			}),
		).rejects.toThrow("Detached continuation is not registered")
		expect(runtime.getState()).toMatchObject({
			revision,
			interaction: { interactionId: "qna-1", kind: "qna_response", status: "awaiting" },
		})
	})

	it("continues and resolves the original detached conversation interaction after its click", async () => {
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "qna_response",
				phase: TaskPhase.EXECUTING,
				turnId: "turn-qna",
				interactionId: "qna-1",
			}),
			createPorts(),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const continuation = vi.fn(async () => undefined)
		coordinator.registerDetachedContinuation(continuation)

		const result = await coordinator.respond({
			taskId: "task-1",
			turnId: "turn-qna",
			interactionId: "qna-1",
			actionId: "reply",
			stateRevision: runtime.getState().revision,
			draft: { text: "Answer", images: ["image"], files: ["file"] },
		})

		expect(result.accepted).toBe(true)
		await coordinator.waitForClaimedContinuations()
		expect(continuation).toHaveBeenCalledOnce()
		expect(continuation).toHaveBeenCalledWith(
			expect.objectContaining({
				interaction: expect.objectContaining({
					kind: "qna_response",
					turnId: "turn-qna",
					interactionId: "qna-1",
					status: "resolving",
				}),
				outcome: {
					actionId: "reply",
					draft: { text: "Answer", images: ["image"], files: ["file"] },
					selection: undefined,
				},
				resolve: expect.any(Function),
			}),
		)
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it.each([
		{ actionId: "approve" as const, expectedPhase: BlockPhase.EXECUTING, siblingPhase: BlockPhase.STREAMING },
		{ actionId: "reject" as const, expectedPhase: BlockPhase.REJECTED, siblingPhase: BlockPhase.SKIPPED },
	])("propagates detached approval action $actionId into the canonical runtime block", async (testCase) => {
		const turnId = "turn-tools"
		const interactionId = "tid-write"
		const turn: TurnState = {
			turnId,
			assistantApiIndex: 2,
			mode: "serial",
			activeDlineTid: interactionId,
			blocks: [
				{
					dlineTid: interactionId,
					functionId: "function-write",
					toolName: "write_to_file",
					phase: BlockPhase.AWAITING_APPROVAL,
					ts: 100,
					requiresApproval: true,
					conversationHistoryIndex: 2,
				},
				{
					dlineTid: "tid-second",
					functionId: "function-second",
					toolName: "execute_command",
					phase: BlockPhase.STREAMING,
					ts: 101,
					requiresApproval: true,
					conversationHistoryIndex: 2,
				},
			],
		}
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "tool_approval",
				phase: TaskPhase.AWAITING_APPROVAL,
				turnId,
				interactionId,
				turn,
			}),
			createPorts(),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const continuation = vi.fn(async () => undefined)
		coordinator.registerDetachedContinuation(continuation)

		const result = await coordinator.respond({
			taskId: "task-1",
			turnId,
			interactionId,
			actionId: testCase.actionId,
			stateRevision: runtime.getState().revision,
			draft: { text: "", images: [], files: [] },
		})

		expect(result.accepted).toBe(true)
		await coordinator.waitForClaimedContinuations()
		expect(continuation).toHaveBeenCalledWith(
			expect.objectContaining({
				interaction: expect.objectContaining({ interactionId, kind: "tool_approval" }),
				outcome: expect.objectContaining({ actionId: testCase.actionId }),
			}),
		)
		expect(runtime.getState().turn?.blocks).toMatchObject([
			{ dlineTid: interactionId, phase: testCase.expectedPhase },
			{ dlineTid: "tid-second", phase: testCase.siblingPhase },
		])
		expect(runtime.getState().interaction).toBeUndefined()
	})

	it("commits detached completion feedback through the completion event", async () => {
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "completion",
				phase: TaskPhase.COMPLETED,
				turnId: "turn-completion",
				interactionId: "completion-1",
			}),
			createPorts(),
		)
		const coordinator = new InteractionCoordinator(runtime)

		const result = await coordinator.respond({
			taskId: "task-1",
			turnId: "turn-completion",
			interactionId: "completion-1",
			actionId: "reply",
			stateRevision: runtime.getState().revision,
			draft: { text: "Refine", images: [], files: [] },
		})

		expect(result.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.STREAMING })
		expect(runtime.getState().interaction).toBeUndefined()
		expect(runtime.getState().completion).toBeUndefined()
	})

	it("commits detached completion Start New Task without exposing Resume", async () => {
		let releaseStartNewTask: (() => void) | undefined
		const startNewTaskLifecycle = new Promise<void>((resolve) => {
			releaseStartNewTask = resolve
		})
		let signalStartNewTask: (() => void) | undefined
		const startNewTaskEntered = new Promise<void>((resolve) => {
			signalStartNewTask = resolve
		})
		const startNewTask = vi.fn(async () => {
			signalStartNewTask?.()
			await startNewTaskLifecycle
		})
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "completion",
				phase: TaskPhase.COMPLETED,
				turnId: "turn-completion",
				interactionId: "completion-1",
			}),
			createPorts({ startNewTask }),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const draft = { text: "Next", images: [], files: [] }

		let result: Awaited<ReturnType<InteractionCoordinator["respond"]>> | undefined
		const response = coordinator
			.respond({
				taskId: "task-1",
				turnId: "turn-completion",
				interactionId: "completion-1",
				actionId: "start_new_task",
				stateRevision: runtime.getState().revision,
				draft,
			})
			.then((value) => {
				result = value
				return value
			})
		await startNewTaskEntered

		try {
			await vi.waitFor(() => expect(result).toMatchObject({ accepted: true }), { timeout: 250 })
			expect(startNewTask).toHaveBeenCalledWith(expect.objectContaining({ type: "START_NEW_TASK", draft }))
			expect(runtime.getState().phase).toBe(TaskPhase.COMPLETED)
			expect(runtime.getState().interaction).toBeUndefined()
		} finally {
			releaseStartNewTask?.()
			await response
		}
	})

	it("returns an admitted retry and reopens Retry when START_API fails asynchronously", async () => {
		let runtime: TaskRuntime
		let attempts = 0
		const startApi = vi.fn(async () => {
			attempts++
			const started = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 7 })
			expect(started.accepted).toBe(true)
			if (attempts === 1) {
				throw new Error("provider failed after retry admission")
			}
		})
		runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "error_retry",
				phase: TaskPhase.AWAITING_APPROVAL,
				turnId: "turn-retry",
				interactionId: "retry-1",
				apiIndex: 7,
			}),
			createPorts({ startApi }),
		)
		const coordinator = new InteractionCoordinator(runtime)
		const draft = { text: "Retry context", images: [], files: [] }

		await expect(
			coordinator.respond({
				taskId: "task-1",
				turnId: "turn-retry",
				interactionId: "retry-1",
				actionId: "retry",
				stateRevision: runtime.getState().revision,
				draft,
			}),
		).resolves.toMatchObject({ accepted: true })
		await vi.waitFor(() => expect(runtime.getState().error?.effectType).toBe("START_API"))

		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.AWAITING_APPROVAL,
			interaction: {
				kind: "error_retry",
				status: "awaiting",
				interactionId: "retry-1",
				acceptedResponse: { actionId: "retry", draft },
			},
			error: { effectType: "START_API", message: "provider failed after retry admission" },
		})

		await expect(
			coordinator.respond({
				taskId: "task-1",
				turnId: "turn-retry",
				interactionId: "retry-1",
				actionId: "retry",
				stateRevision: runtime.getState().revision,
				draft: { text: "Retry again", images: [], files: [] },
			}),
		).resolves.toMatchObject({ accepted: true })
		await vi.waitFor(() => expect(startApi).toHaveBeenCalledTimes(2))
		expect(runtime.getState()).toMatchObject({ phase: TaskPhase.STREAMING, interaction: undefined })
		expect(runtime.getState().error).toBeUndefined()
	})

	it("commits detached error retry from the historical API index and retains identity until admission", async () => {
		const startApi = vi.fn(async () => undefined)
		const runtime = new TaskRuntime(
			hydrateAwaitingInteraction({
				kind: "error_retry",
				phase: TaskPhase.AWAITING_APPROVAL,
				turnId: "turn-retry",
				interactionId: "retry-1",
				apiIndex: 7,
			}),
			createPorts({ startApi }),
		)
		const coordinator = new InteractionCoordinator(runtime)

		const result = await coordinator.respond({
			taskId: "task-1",
			turnId: "turn-retry",
			interactionId: "retry-1",
			actionId: "retry",
			stateRevision: runtime.getState().revision,
			draft: { text: "Retry context", images: [], files: [] },
		})

		expect(result.accepted).toBe(true)
		expect(startApi).toHaveBeenCalledWith(expect.objectContaining({ type: "START_API", apiIndex: 7 }))
		expect(runtime.getState().interaction).toMatchObject({
			kind: "error_retry",
			status: "resolving",
			interactionId: "retry-1",
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 7 })
		expect(admitted.accepted).toBe(true)
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
			hydrateResolvingInteraction({
				kind: "resume",
				phase: TaskPhase.PAUSED,
				turnId,
				interactionId,
				response,
				apiIndex: 2,
			}),
			createPorts(),
		)

		await expect(new InteractionCoordinator(runtime).resumeExisting(interactionId)).resolves.toMatchObject({
			actionId: "resume",
		})
		expect(runtime.getState().phase).toBe(TaskPhase.RESUMING)
		expect(runtime.getState().interaction).toMatchObject({
			kind: "resume",
			status: "resolving",
			interactionId,
			acceptedResponse: { actionId: "resume", draft: response.draft },
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 2 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 2, interactionId: undefined },
		})
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
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			interaction: {
				kind: "error_retry",
				status: "resolving",
				interactionId,
				acceptedResponse: { actionId: "retry", draft: response.draft },
			},
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 7 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 7, interactionId: undefined },
			interaction: undefined,
		})
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
			expect(runtime.getState().interaction).toMatchObject({
				kind: "resume",
				status: "resolving",
				interactionId: "resume-1",
				acceptedResponse: { actionId: "resume", draft: { text: "Continue", images: [], files: [] } },
			})
			expect(startApi).toHaveBeenCalledOnce()
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 2 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 2, interactionId: undefined },
		})
		expect(runtime.getState().interaction).toBeUndefined()
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
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.RESUMING,
			interaction: {
				kind: "resume",
				status: "resolving",
				interactionId: "resume-1",
				acceptedResponse: { actionId: "resume", draft: { text: "Continue", images: [], files: [] } },
			},
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 2 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 2, interactionId: undefined },
		})
		expect(runtime.getState().interaction).toBeUndefined()
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
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.RESUMING,
			anchor: { apiIndex: 2, interactionId: "resume-1" },
			interaction: {
				kind: "resume",
				status: "resolving",
				interactionId: "resume-1",
				acceptedResponse: { actionId: "resume", draft: { text: "Continue", images: [], files: [] } },
			},
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 2 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 2, interactionId: undefined },
		})
		expect(runtime.getState().interaction).toBeUndefined()
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
		expect(runtime.getState().interaction).toMatchObject({
			kind: "error_retry",
			status: "resolving",
			interactionId: "retry-1",
			acceptedResponse: {
				actionId: "retry",
				draft: { text: "context", images: ["image"], files: ["file"] },
			},
		})

		const admitted = await runtime.dispatch({ type: "API_REQUEST_STARTED", apiIndex: 7 })
		expect(admitted.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.STREAMING,
			anchor: { apiIndex: 7, interactionId: undefined },
			interaction: undefined,
		})
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
