import type { InteractionKind } from "./Interaction"
import { getInteraction } from "./InteractionRegistry"
import type { InteractionResponse, InteractionResponseErrorCode } from "./InteractionResponse"

/** Stored presentation anchor for one primary interaction. */
export interface InteractionAnchor {
	messageTs: number
	messageType: "ask" | "say"
}

/** Runtime state for one primary interaction. */
export interface ActiveInteraction {
	taskId: string
	turnId: string
	interactionId: string
	kind: InteractionKind
	status: "opening" | "awaiting" | "resolving"
	createdRevision: number
	anchor?: InteractionAnchor
	acceptedResponse?: InteractionResponse
}

/** Pure response reduction result. */
export type InteractionResult =
	| { accepted: true; next: ActiveInteraction }
	| { accepted: false; next: ActiveInteraction; error: { code: InteractionResponseErrorCode } }

/** Return a typed interaction rejection without changing state. */
function reject(state: ActiveInteraction, code: InteractionResponseErrorCode): InteractionResult {
	return { accepted: false, next: state, error: { code } }
}

/** Validate and reduce one causal interaction response. */
export function reduceInteraction(state: ActiveInteraction, response: InteractionResponse): InteractionResult {
	if (
		response.taskId !== state.taskId ||
		response.turnId !== state.turnId ||
		response.interactionId !== state.interactionId ||
		response.stateRevision < state.createdRevision
	) {
		return reject(state, "stale_interaction")
	}
	if (state.status !== "awaiting") {
		return reject(state, "duplicate_response")
	}

	const action = getInteraction(state.kind).actions.find((candidate) => candidate.type === response.actionId)
	if (!action) {
		return reject(state, "invalid_action")
	}
	const hasDraft = response.draft !== undefined
	const hasSelection = response.selection !== undefined && response.selection.values.length > 0
	if (
		(action.payloadPolicy === "draft" && !hasDraft) ||
		(action.payloadPolicy === "selection" && !hasSelection) ||
		(action.payloadPolicy === "draft_and_selection" && (!hasDraft || !hasSelection))
	) {
		return reject(state, "invalid_interaction_payload")
	}

	return { accepted: true, next: { ...state, status: "resolving", acceptedResponse: response } }
}
