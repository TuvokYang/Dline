import { describe, expect, it, vi } from "vitest"
import type { InteractionDraft } from "../../interaction/InteractionResponse"
import { TaskPhase } from "../../TaskPhase"
import type { TaskEffect } from "../TaskEffect"
import type { TaskEffectPorts } from "../TaskEffectRunner"
import type { TaskEvent } from "../TaskEvent"
import { reduceTask } from "../TaskReducer"
import { TaskRuntime } from "../TaskRuntime"
import { createTaskRuntimeState, type TaskRuntimeState } from "../TaskRuntimeState"

interface RecoveryPorts extends TaskEffectPorts {
	sequence: string[]
}

/** Create effect ports that expose transaction ordering without performing infrastructure work. */
function createPorts(): RecoveryPorts {
	const sequence: string[] = []
	return {
		sequence,
		postView: vi.fn(async () => {
			sequence.push("POST_TASK_VIEW")
		}),
		persistSnapshot: vi.fn(async () => {
			sequence.push("PERSIST_SNAPSHOT")
		}),
		cancelRuntime: vi.fn(async () => {
			sequence.push("CANCEL_RUNTIME")
		}),
		prepareResume: vi.fn(async () => {
			sequence.push("PREPARE_RESUME")
		}),
		startApi: vi.fn(async (effect) => {
			sequence.push(`START_API:${effect.apiIndex}:${effect.draft?.text ?? ""}`)
		}),
		executeTool: vi.fn(async () => undefined),
		appendSay: vi.fn(async () => undefined),
		appendAsk: vi.fn(async (effect) => {
			sequence.push(`APPEND_ASK:${effect.interactionId}`)
			return { uiMessageTs: 500 }
		}),
		startNewTask: vi.fn(async (effect) => {
			sequence.push(`START_NEW_TASK:${effect.draft?.text ?? ""}`)
		}),
	}
}

/** Create an awaiting interaction state without reading UI message history. */
function awaitingInteraction(kind: "tool_approval" | "error_retry" | "completion"): TaskRuntimeState {
	return {
		...createTaskRuntimeState({
			taskId: "task-1",
			phase:
				kind === "completion"
					? TaskPhase.COMPLETED
					: kind === "error_retry"
						? TaskPhase.AWAITING_APPROVAL
						: TaskPhase.STREAMING,
			revision: 4,
			anchor: { apiIndex: 7, turnId: "turn-1", interactionId: "interaction-1" },
		}),
		interaction: {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind,
			status: kind === "tool_approval" ? "awaiting" : "resolving",
			createdRevision: 3,
			anchor: { messageTs: 100, messageType: "ask" },
		},
	}
}

/** Reduce a recovery event that is intentionally specified before its production event union exists. */
function reduceRecovery(state: TaskRuntimeState, event: object) {
	return reduceTask(state, event as TaskEvent)
}

/** Return effect types while preserving the concrete effect payload for later assertions. */
function effectTypes(effects: readonly TaskEffect[]): string[] {
	return effects.map((effect) => effect.type)
}

describe("TaskRuntime recovery transactions", () => {
	it("invalidates the active interaction before ordered cancellation effects", async () => {
		const ports = createPorts()
		const runtime = new TaskRuntime(awaitingInteraction("tool_approval"), ports)

		const result = await runtime.dispatch({ type: "TASK_CANCEL_REQUESTED", source: "user" })

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.CANCELLING,
				cancellation: { source: "user", fromPhase: TaskPhase.STREAMING },
			},
		})
		expect(result.next.interaction).toBeUndefined()
		expect(ports.sequence).toEqual(["POST_TASK_VIEW", "CANCEL_RUNTIME", "PERSIST_SNAPSHOT"])
	})

	it.each([
		["tool_approval", "awaiting"],
		["command_approval", "awaiting"],
		["browser_approval", "awaiting"],
		["mcp_approval", "awaiting"],
		["subagent_approval", "awaiting"],
		["spawn_task_approval", "awaiting"],
		["resume", "awaiting"],
		["error_retry", "awaiting"],
		["status_acknowledgment", "awaiting"],
		["followup", "awaiting"],
		["qna_response", "awaiting"],
		["plan_response", "awaiting"],
		["generate_report", "awaiting"],
		["completion", "awaiting"],
		["followup", "resolving"],
		["qna_response", "resolving"],
		["plan_response", "resolving"],
		["generate_report", "resolving"],
		["completion", "resolving"],
	] as const)("preserves a %s interaction in %s state across terminal shutdown", (kind, status) => {
		const state = awaitingInteraction("tool_approval")
		state.interaction = {
			...state.interaction!,
			kind,
			status,
			...(status === "resolving"
				? {
						acceptedResponse: {
							actionId: "reply",
							stateRevision: state.revision,
							taskId: "task-1",
							turnId: "turn-1",
							interactionId: "interaction-1",
						},
					}
				: {}),
		}

		const result = reduceRecovery(state, { type: "TASK_TERMINATE_REQUESTED" })

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.CANCELLING,
				interaction: { kind, status, interactionId: "interaction-1" },
			},
		})
	})

	it("commits termination without running the pause cleanup effect", () => {
		const result = reduceRecovery(awaitingInteraction("tool_approval"), {
			type: "TASK_TERMINATE_REQUESTED",
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.CANCELLING,
				cancellation: { source: "system", fromPhase: TaskPhase.STREAMING },
			},
		})
		expect(result?.next.interaction).toMatchObject({
			kind: "tool_approval",
			status: "awaiting",
			interactionId: "interaction-1",
		})
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("opens the resume interaction only after cancellation cleanup commits", async () => {
		const ports = createPorts()
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.CANCELLING, revision: 2, anchor: { apiIndex: 7 } }),
			ports,
		)

		const result = await runtime.dispatch({
			type: "TASK_CANCELLED",
			resume: {
				turnId: "resume-turn-1",
				interactionId: "resume-1",
				presentation: "",
			},
		} as TaskEvent)

		expect(result.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.PAUSED,
			interaction: {
				turnId: "resume-turn-1",
				interactionId: "resume-1",
				kind: "resume",
				status: "awaiting",
				anchor: { messageTs: 500, messageType: "ask" },
			},
		})
		expect(ports.sequence).toEqual(["APPEND_ASK:resume-1", "POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("projects a canonical Resume interaction after chat restore without starting the provider", () => {
		const state = awaitingInteraction("tool_approval")

		const result = reduceRecovery(state, { type: "CHECKPOINT_CHAT_RESTORED", apiIndex: 2 })

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.PAUSED,
				anchor: {
					apiIndex: 2,
					turnId: "checkpoint-resume:task-1:5",
					interactionId: "checkpoint-resume:task-1:5",
				},
				interaction: {
					kind: "resume",
					status: "opening",
					interactionId: "checkpoint-resume:task-1:5",
				},
			},
		})
		expect(result.next.turn).toBeUndefined()
		expect(effectTypes(result.effects)).toEqual(["APPEND_ASK"])
	})

	it("continues edited chat restore through exactly one provider effect", () => {
		const state = awaitingInteraction("tool_approval")
		const draft: InteractionDraft = { text: "edited input", images: [], files: [] }

		const result = reduceRecovery(state, { type: "CHECKPOINT_CHAT_RESTORED", apiIndex: 2, draft })

		expect(result).toMatchObject({
			accepted: true,
			next: { phase: TaskPhase.RESUMING, anchor: { apiIndex: 2 } },
		})
		expect(result.next.interaction).toBeUndefined()
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "START_API", "PERSIST_SNAPSHOT"])
		expect(result.effects.filter((effect) => effect.type === "START_API")).toHaveLength(1)
		expect(result.effects[1]).toMatchObject({ type: "START_API", apiIndex: 2, draft })
	})

	it("keeps an edited chat restore active when the superseded provider fails late", async () => {
		let signalOldApiStarted: (() => void) | undefined
		const oldApiStarted = new Promise<void>((resolve) => {
			signalOldApiStarted = resolve
		})
		let rejectOldApi: ((error: Error) => void) | undefined
		const oldApi = new Promise<void>((_resolve, reject) => {
			rejectOldApi = reject
		})
		let signalRestoredApiStarted: (() => void) | undefined
		const restoredApiStarted = new Promise<void>((resolve) => {
			signalRestoredApiStarted = resolve
		})
		let releaseRestoredApi: (() => void) | undefined
		const restoredApi = new Promise<void>((resolve) => {
			releaseRestoredApi = resolve
		})
		const ports = createPorts()
		vi.mocked(ports.startApi).mockImplementation(async (effect) => {
			if (effect.apiIndex === 8) {
				signalOldApiStarted?.()
				await oldApi
				return
			}
			signalRestoredApiStarted?.()
			await restoredApi
		})
		const runtime = new TaskRuntime(
			createTaskRuntimeState({
				taskId: "task-1",
				phase: TaskPhase.STREAMING,
				revision: 4,
				anchor: { apiIndex: 7 },
			}),
			ports,
		)

		const oldRequest = runtime.dispatch({ type: "API_RETRY_SCHEDULED", apiIndex: 8 })
		await oldApiStarted
		const restoredRequest = runtime.dispatch({
			type: "CHECKPOINT_CHAT_RESTORED",
			apiIndex: 2,
			draft: { text: "edited input", images: [], files: [] },
		})
		await restoredApiStarted

		rejectOldApi?.(new Error("superseded provider failed late"))
		await oldRequest

		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.RESUMING,
			anchor: { apiIndex: 2 },
		})
		expect(runtime.getState().error).toBeUndefined()

		releaseRestoredApi?.()
		await restoredRequest
	})

	it("retries from a causal error response with draft attachments in one API effect", () => {
		const draft: InteractionDraft = { text: "retry with this context", images: ["image"], files: ["file"] }
		const state = awaitingInteraction("error_retry")
		if (!state.interaction) throw new Error("test interaction missing")
		state.interaction.acceptedResponse = {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "retry",
			stateRevision: state.revision,
			draft,
		}
		const result = reduceRecovery(state, {
			type: "ERROR_RETRY_REQUESTED",
			apiIndex: 7,
			draft,
		})

		expect(result).toMatchObject({
			accepted: true,
			next: {
				phase: TaskPhase.STREAMING,
				interaction: { kind: "error_retry", status: "resolving", acceptedResponse: { draft } },
			},
		})
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "START_API", "PERSIST_SNAPSHOT"])
		expect(result.effects[1]).toMatchObject({ type: "START_API", apiIndex: 7, draft })

		const admitted = reduceRecovery(result.next, { type: "API_REQUEST_STARTED", apiIndex: 7 })
		expect(admitted).toMatchObject({ accepted: true, next: { phase: TaskPhase.STREAMING } })
		expect(admitted.next.interaction).toBeUndefined()
	})

	it("opens one retry interaction when automatic retries are exhausted", async () => {
		const ports = createPorts()
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, revision: 8, anchor: { apiIndex: 7 } }),
			ports,
		)

		const result = await runtime.dispatch({
			type: "API_RETRY_EXHAUSTED",
			turnId: "retry-turn-1",
			interactionId: "retry-1",
			presentation: "provider unavailable",
		} as TaskEvent)

		expect(result.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.AWAITING_APPROVAL,
			interaction: { kind: "error_retry", interactionId: "retry-1", status: "awaiting" },
		})
		expect(ports.sequence).toEqual(["APPEND_ASK:retry-1", "POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("presents completion as canonical completed state with one causal interaction", async () => {
		const ports = createPorts()
		const runtime = new TaskRuntime(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.EXECUTING, revision: 10, anchor: { apiIndex: 7 } }),
			ports,
		)

		const result = await runtime.dispatch({
			type: "ATTEMPT_COMPLETION_PRESENTED",
			completionId: "completion-1",
			turnId: "turn-completion-1",
			interactionId: "completion-1",
			presentation: "done",
			existingTs: 200,
		} as TaskEvent)

		expect(result.accepted).toBe(true)
		expect(runtime.getState()).toMatchObject({
			phase: TaskPhase.COMPLETED,
			completion: { completionId: "completion-1" },
			interaction: { kind: "completion", interactionId: "completion-1", status: "awaiting" },
		})
		expect(ports.sequence).toEqual(["APPEND_ASK:completion-1", "POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("returns completion feedback to streaming without a separate completion flag", () => {
		const draft: InteractionDraft = { text: "refine the result", images: [], files: [] }
		const result = reduceRecovery(awaitingInteraction("completion"), {
			type: "COMPLETION_FEEDBACK_RECEIVED",
			draft,
		})

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.STREAMING } })
		expect(result.next.interaction).toBeUndefined()
		expect(result.next.completion).toBeUndefined()
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT"])
	})

	it("keeps completion terminal while ordered start-new-task cleanup runs", () => {
		const draft: InteractionDraft = { text: "", images: [], files: [] }
		const result = reduceRecovery(awaitingInteraction("completion"), {
			type: "TASK_CLEAR_REQUESTED",
			draft,
		})

		expect(result).toMatchObject({ accepted: true, next: { phase: TaskPhase.COMPLETED, interaction: undefined } })
		expect(effectTypes(result.effects)).toEqual(["POST_TASK_VIEW", "PERSIST_SNAPSHOT", "START_NEW_TASK"])
		expect(result.effects[2]).toMatchObject({ type: "START_NEW_TASK", draft })
	})
})
