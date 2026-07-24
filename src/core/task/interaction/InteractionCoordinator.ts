import type { TaskEvent } from "../runtime/TaskEvent"
import type { TaskDispatchResult, TaskRuntime } from "../runtime/TaskRuntime"
import type { InteractionKind } from "./Interaction"
import type { InteractionDraft, InteractionResponse, InteractionSelection } from "./InteractionResponse"

/** Request used to open one primary interaction. */
export interface OpenInteractionRequest {
	turnId: string
	interactionId: string
	kind: InteractionKind
	presentation: string
	existingTs?: number
}

/** Request used to present and resolve one completion transaction. */
export interface CompleteInteractionRequest {
	turnId: string
	interactionId: string
	completionId: string
	presentation: string
	existingTs?: number
}

/** Request used to present and resolve one exhausted retry transaction. */
export interface RetryInteractionRequest {
	turnId: string
	interactionId: string
	apiIndex: number
	presentation: string
}

/** Typed user outcome returned to one interaction consumer. */
export interface InteractionOutcome {
	actionId: InteractionResponse["actionId"]
	draft?: InteractionDraft
	selection?: InteractionSelection
}

/** Coordinates one active interaction between runtime events and a handler waiter. */
export class InteractionCoordinator {
	private readonly waitingInteractionIds = new Set<string>()

	constructor(private readonly runtime: TaskRuntime) {}

	/** Dispatch one response and synchronously consume live resume continuation when no waiter owns it. */
	async respond(response: InteractionResponse): Promise<TaskDispatchResult> {
		const result = await this.runtime.dispatch({ type: "INTERACTION_RESPONDED", response })
		if (!result.accepted || this.waitingInteractionIds.has(response.interactionId)) return result
		const interaction = result.next.interaction
		if (interaction?.kind === "resume" && interaction.status === "resolving") {
			await this.commitResume(interaction.interactionId, response)
		}
		return result
	}

	/** Open or strictly take over one interaction and wait for its causal response. */
	async open(request: OpenInteractionRequest): Promise<InteractionOutcome> {
		const response = await this.waitForPresentedResponse(request, {
			type: "INTERACTION_OPEN_REQUESTED",
			...request,
		})
		const resolved = await this.runtime.dispatch({
			type: "INTERACTION_RESOLVED",
			interactionId: request.interactionId,
		})
		if (!resolved.accepted) {
			throw new Error(`Interaction resolve rejected: ${resolved.error?.code ?? "invalid_runtime_event"}`)
		}
		return { actionId: response.actionId, draft: response.draft, selection: response.selection }
	}

	/** Open one resume interaction and commit its causal continuation. */
	async resume(request: OpenInteractionRequest): Promise<InteractionOutcome> {
		const response = await this.waitForPresentedResponse(request, {
			type: "INTERACTION_OPEN_REQUESTED",
			...request,
		})
		return this.commitResume(request.interactionId, response)
	}

	/** Take over one hydrated resume interaction and commit its causal continuation. */
	async resumeExisting(interactionId: string): Promise<InteractionOutcome> {
		const interaction = this.runtime.getState().interaction
		if (!interaction) throw new Error("Hydrated resume interaction is missing")
		const response = await this.waitForExistingResponse(interactionId, interaction.turnId, "resume")
		return this.commitResume(interactionId, response)
	}

	/** Commit one accepted resume response through its typed continuation event. */
	private async commitResume(interactionId: string, response: InteractionResponse): Promise<InteractionOutcome> {
		const committed = await this.runtime.dispatch({
			type: "TASK_RESUME_REQUESTED",
			interactionId,
			draft: response.draft ?? { text: "", images: [], files: [] },
		})
		if (!committed.accepted) {
			throw new Error(`Resume continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return { actionId: response.actionId, draft: response.draft, selection: response.selection }
	}

	/** Present completion and commit the selected continuation as one backend transaction. */
	async complete(request: CompleteInteractionRequest): Promise<InteractionOutcome> {
		const response = await this.waitForPresentedResponse(
			{ ...request, kind: "completion" },
			{
				type: "ATTEMPT_COMPLETION_PRESENTED",
				...request,
			},
		)
		const continuation: TaskEvent =
			response.actionId === "start_new_task"
				? {
						type: "TASK_CLEAR_REQUESTED",
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
				: {
						type: "COMPLETION_FEEDBACK_RECEIVED",
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
		const committed = await this.runtime.dispatch(continuation)
		if (!committed.accepted) {
			throw new Error(`Completion continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return { actionId: response.actionId, draft: response.draft, selection: response.selection }
	}

	/** Present exhausted retry recovery and commit the selected continuation. */
	async recover(request: RetryInteractionRequest): Promise<InteractionOutcome> {
		const response = await this.waitForPresentedResponse(
			{ ...request, kind: "error_retry" },
			{
				type: "API_RETRY_EXHAUSTED",
				...request,
			},
		)
		const continuation: TaskEvent =
			response.actionId === "start_new_task"
				? {
						type: "TASK_CLEAR_REQUESTED",
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
				: {
						type: "ERROR_RETRY_REQUESTED",
						apiIndex: request.apiIndex,
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
		const committed = await this.runtime.dispatch(continuation)
		if (!committed.accepted) {
			throw new Error(`Retry continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return { actionId: response.actionId, draft: response.draft, selection: response.selection }
	}

	/** Use an exact hydrated interaction when present, otherwise present a new one. */
	private async waitForPresentedResponse(
		request: Pick<OpenInteractionRequest, "turnId" | "interactionId" | "kind">,
		openingEvent: TaskEvent,
	): Promise<InteractionResponse> {
		if (this.runtime.getState().interaction) {
			try {
				return await this.waitForExistingResponse(request.interactionId, request.turnId, request.kind)
			} catch (error) {
				throw new Error("Interaction open rejected: hydrated_interaction_mismatch", { cause: error })
			}
		}
		return this.waitForResponse(request.interactionId, openingEvent)
	}

	/** Wait for a causal response to one already hydrated interaction. */
	private async waitForExistingResponse(
		interactionId: string,
		turnId: string,
		kind: InteractionKind,
	): Promise<InteractionResponse> {
		const interaction = this.runtime.getState().interaction
		if (
			!interaction ||
			interaction.interactionId !== interactionId ||
			interaction.turnId !== turnId ||
			interaction.kind !== kind
		) {
			throw new Error("Hydrated interaction does not match the requested continuation")
		}
		if (interaction.status === "resolving") {
			if (!interaction.acceptedResponse) {
				throw new Error("Hydrated resolving interaction is missing its accepted response")
			}
			return interaction.acceptedResponse
		}
		if (interaction.status !== "awaiting") {
			throw new Error("Hydrated interaction is not awaiting the requested continuation")
		}
		this.waitingInteractionIds.add(interactionId)
		let resolveResponse: ((response: InteractionResponse) => void) | undefined
		const responsePromise = new Promise<InteractionResponse>((resolve) => {
			resolveResponse = resolve
		})
		const unsubscribe = this.runtime.subscribe((event, result) => {
			this.captureResponse(interactionId, event, result, resolveResponse)
		})
		try {
			return await responsePromise
		} finally {
			this.waitingInteractionIds.delete(interactionId)
			unsubscribe()
		}
	}

	/** Dispatch an opening event and wait for its causally matching accepted response. */
	private async waitForResponse(interactionId: string, openingEvent: TaskEvent): Promise<InteractionResponse> {
		this.waitingInteractionIds.add(interactionId)
		let resolveResponse: ((response: InteractionResponse) => void) | undefined
		const responsePromise = new Promise<InteractionResponse>((resolve) => {
			resolveResponse = resolve
		})
		const unsubscribe = this.runtime.subscribe((event, result) => {
			this.captureResponse(interactionId, event, result, resolveResponse)
		})
		try {
			const opened = await this.runtime.dispatch(openingEvent)
			if (!opened.accepted) {
				throw new Error(`Interaction open rejected: ${opened.error?.code ?? "invalid_runtime_event"}`)
			}
			return await responsePromise
		} finally {
			this.waitingInteractionIds.delete(interactionId)
			unsubscribe()
		}
	}

	/** Capture only an accepted response for the interaction owned by this waiter. */
	private captureResponse(
		interactionId: string,
		event: TaskEvent,
		result: TaskDispatchResult,
		resolveResponse: ((response: InteractionResponse) => void) | undefined,
	): void {
		if (event.type === "INTERACTION_RESPONDED" && result.accepted && event.response.interactionId === interactionId) {
			resolveResponse?.(event.response)
		}
	}
}
