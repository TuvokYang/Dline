import type { TaskEvent } from "../runtime/TaskEvent"
import type { TaskDispatchResult, TaskRuntime } from "../runtime/TaskRuntime"
import type { InteractionKind } from "./Interaction"
import type { ActiveInteraction } from "./InteractionReducer"
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

/** Context passed to the Task-owned continuation for a restored handler interaction. */
export interface DetachedInteractionContinuationContext {
	interaction: Readonly<ActiveInteraction>
	outcome: InteractionOutcome
	/** Return whether this continuation still belongs to the active cancellation generation. */
	isCurrent(): boolean
	/** Resolve the original interaction before opening a causally subsequent interaction. */
	resolve(): Promise<void>
}

/** Continue one accepted interaction when no live handler waiter survived restoration. */
export type DetachedInteractionContinuation = (context: DetachedInteractionContinuationContext) => Promise<void>

type RuntimeOwnedInteractionKind = "resume" | "completion" | "error_retry"

function isRuntimeOwnedInteraction(kind: InteractionKind): kind is RuntimeOwnedInteractionKind {
	return kind === "resume" || kind === "completion" || kind === "error_retry"
}

function outcomeFrom(response: InteractionResponse): InteractionOutcome {
	return { actionId: response.actionId, draft: response.draft, selection: response.selection }
}

/** Select only interaction continuations that can safely carry an internal compact signal. */
function modeCompactionAction(kind: InteractionKind): InteractionResponse["actionId"] | undefined {
	switch (kind) {
		case "followup":
		case "make_plan":
		case "qna_response":
		case "generate_report":
		case "completion":
			return "reply"
		case "status_acknowledgment":
			return "acknowledge"
		default:
			return undefined
	}
}

/** Coordinates one active interaction between runtime events and a handler waiter. */
export class InteractionCoordinator {
	private readonly waitingInteractionIds = new Set<string>()
	private readonly waitingInteractionRejectors = new Map<string, (error: Error) => void>()
	private readonly claimedContinuations = new Map<string, Promise<InteractionOutcome>>()
	private detachedContinuation?: DetachedInteractionContinuation
	private continuationGeneration = 0
	private readonly activeCancellationGenerations = new Set<number>()

	constructor(private readonly runtime: TaskRuntime) {}

	/** Register the sole Task-owned continuation for restored handler interactions. */
	registerDetachedContinuation(continuation: DetachedInteractionContinuation): () => void {
		if (this.detachedContinuation && this.detachedContinuation !== continuation) {
			throw new Error("Detached interaction continuation is already registered")
		}
		this.detachedContinuation = continuation
		return () => {
			if (this.detachedContinuation === continuation) {
				this.detachedContinuation = undefined
			}
		}
	}

	/** Fence old continuations and reject live waiters as soon as cancellation is requested. */
	cancelPending(reason = "task_cancelled"): number {
		const generation = ++this.continuationGeneration
		this.activeCancellationGenerations.add(generation)
		for (const reject of this.waitingInteractionRejectors.values()) {
			reject(new Error(reason))
		}
		this.waitingInteractionRejectors.clear()
		return generation
	}

	/** Release one cancellation transaction without making its old continuations current again. */
	completeCancellation(generation: number): void {
		this.activeCancellationGenerations.delete(generation)
	}

	/** Wait until every continuation already admitted by an interaction response has exited. */
	async waitForClaimedContinuations(): Promise<void> {
		while (true) {
			const pending = [...this.claimedContinuations.values()]
			if (pending.length === 0) return
			await Promise.allSettled(pending)
		}
	}

	/** Dispatch one response and synchronously consume resume continuation only when no waiter owns it. */
	async respond(response: InteractionResponse): Promise<TaskDispatchResult> {
		const generation = this.continuationGeneration
		if (!this.isCurrentGeneration(generation)) return this.staleResponseResult()
		const waiterOwnsContinuation = this.waitingInteractionIds.has(response.interactionId)
		const current = this.runtime.getState()
		const currentInteraction = current.interaction
		const targetsCurrentAwaitingInteraction =
			currentInteraction?.status === "awaiting" &&
			currentInteraction.taskId === response.taskId &&
			currentInteraction.turnId === response.turnId &&
			currentInteraction.interactionId === response.interactionId &&
			response.stateRevision === current.revision
		const detachedContinuation = this.detachedContinuation
		if (
			!waiterOwnsContinuation &&
			targetsCurrentAwaitingInteraction &&
			currentInteraction &&
			!isRuntimeOwnedInteraction(currentInteraction.kind) &&
			!detachedContinuation
		) {
			throw new Error(`Detached continuation is not registered for interaction kind=${currentInteraction.kind}`)
		}

		const result = await this.runtime.dispatch({ type: "INTERACTION_RESPONDED", response })
		if (!result.accepted) return result
		if (!this.isCurrentGeneration(generation)) return this.staleResponseResult()
		if (waiterOwnsContinuation) return result
		const interaction = result.next.interaction
		if (interaction?.status === "resolving") {
			const continuation = this.claimContinuation(interaction.interactionId, generation, () =>
				this.commitDetachedInteraction(interaction, response, generation, detachedContinuation),
			)
			const continuesInBackground =
				!isRuntimeOwnedInteraction(interaction.kind) ||
				(interaction.kind === "completion" && response.actionId !== "start_new_task")
			if (continuesInBackground) {
				void continuation.catch(() => undefined)
			} else {
				await continuation
			}
		}
		return result
	}

	/** Return whether the current awaiting interaction can safely initiate mode compaction. */
	canRespondForModeCompaction(): boolean {
		const interaction = this.runtime.getState().interaction
		return interaction?.status === "awaiting" && modeCompactionAction(interaction.kind) !== undefined
	}

	/** Resolve one conversational interaction with a backend-only compaction signal. */
	async respondForModeCompaction(text: string): Promise<boolean> {
		const state = this.runtime.getState()
		const interaction = state.interaction
		const actionId = interaction?.status === "awaiting" ? modeCompactionAction(interaction.kind) : undefined
		if (!interaction || !actionId) return false
		const result = await this.respond({
			taskId: interaction.taskId,
			turnId: interaction.turnId,
			interactionId: interaction.interactionId,
			actionId,
			stateRevision: state.revision,
			draft: { text, images: [], files: [] },
		})
		return result.accepted
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

	/** Claim and commit one accepted resume continuation exactly once per interaction identity. */
	private commitResume(interactionId: string, response: InteractionResponse): Promise<InteractionOutcome> {
		const generation = this.continuationGeneration
		return this.claimContinuation(interactionId, generation, () => this.commitClaimedResume(interactionId, response))
	}

	/** Claim one continuation while concurrent callers still reference the same interaction. */
	private claimContinuation(
		interactionId: string,
		generation: number,
		commit: () => Promise<InteractionOutcome>,
	): Promise<InteractionOutcome> {
		const existing = this.claimedContinuations.get(interactionId)
		if (existing) return existing
		if (!this.isCurrentGeneration(generation)) {
			return Promise.reject(new Error("task_cancelled"))
		}
		const continuation = commit()
		this.claimedContinuations.set(interactionId, continuation)
		const clear = () => {
			if (this.claimedContinuations.get(interactionId) === continuation) {
				this.claimedContinuations.delete(interactionId)
			}
		}
		void continuation.then(clear, clear)
		return continuation
	}

	/** Commit the typed continuation selected by one accepted detached response. */
	private async commitDetachedInteraction(
		interaction: ActiveInteraction,
		response: InteractionResponse,
		generation: number,
		detachedContinuation?: DetachedInteractionContinuation,
	): Promise<InteractionOutcome> {
		switch (interaction.kind) {
			case "resume":
				return this.commitClaimedResume(interaction.interactionId, response)
			case "completion":
				if (response.actionId === "start_new_task") {
					return this.commitCompletionResponse(response)
				}
				await this.commitCompletionResponse(response)
				if (!this.isCurrentGeneration(generation)) return outcomeFrom(response)
				if (!detachedContinuation) {
					throw new Error("Detached continuation is not registered for completion feedback")
				}
				return this.commitHandlerResponse(interaction, response, generation, detachedContinuation)
			case "error_retry":
				return this.commitErrorRetryResponse(response, this.runtime.getState().anchor.apiIndex)
			default:
				if (!detachedContinuation) {
					throw new Error(`Detached continuation is not registered for interaction kind=${interaction.kind}`)
				}
				return this.commitHandlerResponse(interaction, response, generation, detachedContinuation)
		}
	}

	/** Commit the already claimed resume continuation through its typed runtime event. */
	private async commitClaimedResume(interactionId: string, response: InteractionResponse): Promise<InteractionOutcome> {
		const committed = await this.runtime.dispatchAtAdmission({
			type: "TASK_RESUME_REQUESTED",
			interactionId,
			draft: response.draft ?? { text: "", images: [], files: [] },
		})
		if (!committed.accepted) {
			throw new Error(`Resume continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return outcomeFrom(response)
	}

	/** Let the Task continue one restored handler, then resolve its original interaction. */
	private async commitHandlerResponse(
		interaction: ActiveInteraction,
		response: InteractionResponse,
		generation: number,
		continuation: DetachedInteractionContinuation,
	): Promise<InteractionOutcome> {
		const outcome = outcomeFrom(response)
		let resolvePromise: Promise<void> | undefined
		const resolve = () => {
			if (!resolvePromise) {
				resolvePromise = this.resolveInteraction(interaction.interactionId)
			}
			return resolvePromise
		}
		await continuation({
			interaction,
			outcome,
			isCurrent: () => this.isCurrentGeneration(generation),
			resolve,
		})
		if (!this.isCurrentGeneration(generation)) return outcome
		await resolve()
		return outcome
	}

	/** Return whether asynchronous work still belongs to the latest non-cancelling generation. */
	private isCurrentGeneration(generation: number): boolean {
		return generation === this.continuationGeneration && this.activeCancellationGenerations.size === 0
	}

	/** Reject a response whose continuation lost admission to a newer cancellation transaction. */
	private staleResponseResult(): TaskDispatchResult {
		const current = this.runtime.getState()
		return {
			accepted: false,
			next: { ...current },
			effects: [],
			error: {
				code: "stale_interaction",
				eventType: "INTERACTION_RESPONDED",
				phase: current.phase,
			},
		}
	}

	/** Resolve exactly the original accepted interaction. */
	private async resolveInteraction(interactionId: string): Promise<void> {
		const active = this.runtime.getState().interaction
		if (!active || active.interactionId !== interactionId) {
			return
		}
		const resolved = await this.runtime.dispatch({ type: "INTERACTION_RESOLVED", interactionId })
		if (!resolved.accepted) {
			throw new Error(`Interaction resolve rejected: ${resolved.error?.code ?? "invalid_runtime_event"}`)
		}
	}

	/** Commit one accepted completion response through its typed lifecycle event. */
	private async commitCompletionResponse(response: InteractionResponse): Promise<InteractionOutcome> {
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
		const committed = await (response.actionId === "start_new_task"
			? this.runtime.dispatchAtAdmission(continuation)
			: this.runtime.dispatch(continuation))
		if (!committed.accepted) {
			throw new Error(`Completion continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return outcomeFrom(response)
	}

	/** Commit one accepted API-error response through its typed lifecycle event. */
	private async commitErrorRetryResponse(response: InteractionResponse, apiIndex: number): Promise<InteractionOutcome> {
		const continuation: TaskEvent =
			response.actionId === "start_new_task"
				? {
						type: "TASK_CLEAR_REQUESTED",
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
				: {
						type: "ERROR_RETRY_REQUESTED",
						apiIndex,
						draft: response.draft ?? { text: "", images: [], files: [] },
					}
		const committed = await this.runtime.dispatchAtAdmission(continuation)
		if (!committed.accepted) {
			throw new Error(`Retry continuation rejected: ${committed.error?.code ?? "invalid_runtime_event"}`)
		}
		return outcomeFrom(response)
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
		return this.commitCompletionResponse(response)
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
		return this.commitErrorRetryResponse(response, request.apiIndex)
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
		const generation = this.continuationGeneration
		if (!this.isCurrentGeneration(generation)) throw new Error("task_cancelled")
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
		const responsePromise = new Promise<InteractionResponse>((resolve, reject) => {
			resolveResponse = resolve
			this.waitingInteractionRejectors.set(interactionId, reject)
		})
		const unsubscribe = this.runtime.subscribe((event, result) => {
			this.captureResponse(interactionId, generation, event, result, resolveResponse)
		})
		try {
			const response = await responsePromise
			if (!this.isCurrentGeneration(generation)) throw new Error("task_cancelled")
			return response
		} finally {
			this.waitingInteractionIds.delete(interactionId)
			this.waitingInteractionRejectors.delete(interactionId)
			unsubscribe()
		}
	}

	/** Dispatch an opening event and wait for its causally matching accepted response. */
	private async waitForResponse(interactionId: string, openingEvent: TaskEvent): Promise<InteractionResponse> {
		const generation = this.continuationGeneration
		if (!this.isCurrentGeneration(generation)) throw new Error("task_cancelled")
		this.waitingInteractionIds.add(interactionId)
		let resolveResponse: ((response: InteractionResponse) => void) | undefined
		const responsePromise = new Promise<InteractionResponse>((resolve, reject) => {
			resolveResponse = resolve
			this.waitingInteractionRejectors.set(interactionId, reject)
		})
		const unsubscribe = this.runtime.subscribe((event, result) => {
			this.captureResponse(interactionId, generation, event, result, resolveResponse)
		})
		try {
			const opened = await this.runtime.dispatch(openingEvent)
			if (!opened.accepted) {
				throw new Error(`Interaction open rejected: ${opened.error?.code ?? "invalid_runtime_event"}`)
			}
			const response = await responsePromise
			if (!this.isCurrentGeneration(generation)) throw new Error("task_cancelled")
			return response
		} finally {
			this.waitingInteractionIds.delete(interactionId)
			this.waitingInteractionRejectors.delete(interactionId)
			unsubscribe()
		}
	}

	/** Capture only an accepted response for the interaction owned by this waiter. */
	private captureResponse(
		interactionId: string,
		generation: number,
		event: TaskEvent,
		result: TaskDispatchResult,
		resolveResponse: ((response: InteractionResponse) => void) | undefined,
	): void {
		if (
			this.isCurrentGeneration(generation) &&
			event.type === "INTERACTION_RESPONDED" &&
			result.accepted &&
			event.response.interactionId === interactionId
		) {
			resolveResponse?.(event.response)
		}
	}
}
