import type { TaskViewActionType, TaskViewState } from "@shared/ExtensionMessage"
import type { DispatchInteractionRequest, DispatchInteractionResponse } from "@shared/proto/dline/task"

/** Draft content owned by the task interaction host. */
export interface InteractionDraft {
	text: string
	images: string[]
	files: string[]
}

/** Selection values owned by selection-aware presentation renderers. */
export interface InteractionSelection {
	values: string[]
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
