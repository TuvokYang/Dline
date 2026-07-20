import type { TaskViewActionType, TaskViewState } from "@shared/ExtensionMessage"
import type { DispatchInteractionRequest, DispatchInteractionResponse } from "@shared/proto/dline/task"

/** Complete Webview draft snapshot owned by the chat composition root. */
export interface InteractionDraft {
	text: string
	images: string[]
	files: string[]
	activeQuote?: string | null
	ownerRevision?: number
}

/** Capture mutable draft values before dispatching an interaction. */
export function captureInteractionDraft(draft: InteractionDraft): InteractionDraft {
	return {
		text: draft.text,
		images: [...draft.images],
		files: [...draft.files],
		activeQuote: draft.activeQuote ?? null,
		ownerRevision: draft.ownerRevision,
	}
}

/** Compare complete draft ownership state before applying an accepted settlement. */
export function isSameInteractionDraft(current: InteractionDraft, captured: InteractionDraft): boolean {
	return (
		current.text === captured.text &&
		current.activeQuote === captured.activeQuote &&
		current.ownerRevision === captured.ownerRevision &&
		current.images.length === captured.images.length &&
		current.images.every((image, index) => image === captured.images[index]) &&
		current.files.length === captured.files.length &&
		current.files.every((file, index) => file === captured.files[index])
	)
}

/** Accepted interaction identity and exact draft snapshot returned to the composition owner. */
export interface AcceptedInteractionSettlement {
	readonly taskId: string
	readonly turnId: string
	readonly interactionId: string
	readonly stateRevision: number
	readonly draft: InteractionDraft
}

/** Selection values owned by selection-aware presentation renderers. */
export interface InteractionSelection {
	values: string[]
}

/** Create an immutable accepted settlement from the exact dispatched request. */
export function createAcceptedInteractionSettlement(
	request: DispatchInteractionRequest,
	draft: InteractionDraft,
): AcceptedInteractionSettlement {
	return {
		taskId: request.taskId,
		turnId: request.turnId,
		interactionId: request.interactionId,
		stateRevision: request.stateRevision,
		draft: captureInteractionDraft(draft),
	}
}

/** Guard the composition owner against stale accepted responses. */
export function canApplyAcceptedInteractionSettlement(
	currentTaskId: string | undefined,
	currentDraft: InteractionDraft,
	settlement: AcceptedInteractionSettlement,
): boolean {
	return currentTaskId === settlement.taskId && isSameInteractionDraft(currentDraft, settlement.draft)
}

/** Injectable causal protocol boundary used by interaction components. */
export type DispatchInteraction = (request: DispatchInteractionRequest) => Promise<DispatchInteractionResponse>

/** Build one causal request from the current backend projection. */
export function buildInteractionRequest(
	view: TaskViewState,
	actionId: TaskViewActionType,
	draft: InteractionDraft,
	selection?: InteractionSelection,
): DispatchInteractionRequest | undefined {
	const interaction = view.activeInteraction
	if (!interaction) {
		return undefined
	}
	return {
		taskId: interaction.taskId,
		turnId: interaction.turnId,
		interactionId: interaction.interactionId,
		actionId,
		stateRevision: interaction.stateRevision,
		draft: { text: draft.text, images: [...draft.images], files: [...draft.files] },
		selection: selection ? { values: [...selection.values] } : undefined,
	}
}
