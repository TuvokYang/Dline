import type { InteractionActionType } from "./Interaction"

/** Draft content submitted with an interaction action. */
export interface InteractionDraft {
	text: string
	images: string[]
	files: string[]
}

/** Selection values submitted by selection-aware interactions. */
export interface InteractionSelection {
	values: string[]
}

/** Causally identified interaction response from the Webview. */
export interface InteractionResponse {
	taskId: string
	turnId: string
	interactionId: string
	actionId: InteractionActionType
	stateRevision: number
	draft?: InteractionDraft
	selection?: InteractionSelection
}

/** Expected validation failures that do not throw. */
export type InteractionResponseErrorCode =
	| "stale_interaction"
	| "invalid_action"
	| "invalid_interaction_payload"
	| "duplicate_response"
