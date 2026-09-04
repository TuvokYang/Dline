import type { ActiveInteractionView, TaskInputViewState, TaskViewAction } from "@shared/ExtensionMessage"
import type { ActiveInteraction } from "../interaction/InteractionReducer"
import { getInteraction } from "../interaction/InteractionRegistry"

/** Projection diagnostic returned for an invalid interaction anchor. */
export interface InteractionProjectionDiagnostic {
	code: "interaction_anchor_missing" | "interaction_anchor_is_say"
	interactionId: string
}

/** Complete projection result for one active interaction. */
export interface InteractionProjectionResult {
	view?: ActiveInteractionView
	input?: TaskInputViewState
	actions?: TaskViewAction[]
	diagnostic?: InteractionProjectionDiagnostic
}

/** Project one interaction without reading UI or API messages. */
export function projectInteraction(interaction: Readonly<ActiveInteraction>, stateRevision: number): InteractionProjectionResult {
	if (!interaction.anchor) {
		return {
			diagnostic: { code: "interaction_anchor_missing", interactionId: interaction.interactionId },
		}
	}
	if (interaction.anchor.messageType === "say") {
		return {
			diagnostic: { code: "interaction_anchor_is_say", interactionId: interaction.interactionId },
		}
	}

	const definition = getInteraction(interaction.kind)
	const input: TaskInputViewState = {
		...definition.input,
		enabled: definition.input.enabled && interaction.status === "awaiting",
	}
	const actions: TaskViewAction[] = definition.actions.map((action) => ({
		...action,
		enabled: interaction.status === "awaiting",
		dispatchTarget: "interaction",
	}))
	return {
		view: {
			taskId: interaction.taskId,
			turnId: interaction.turnId,
			interactionId: interaction.interactionId,
			kind: interaction.kind,
			status: interaction.status,
			stateRevision,
			// The anchor is the ask the Webview actually rendered. Falling back to
			// the definition only covers first presentation, where the two agree
			// because the ask was raised from this very definition.
			taskAsk: interaction.anchor.taskAsk ?? definition.taskAsk,
			// Keep the legacy renderer key only at the Webview presentation boundary.
			presentationKind: interaction.kind === "change_todo_list" ? "focus_chain_change" : definition.presentationKind,
			askMessageTs: interaction.anchor.messageTs,
		},
		input,
		actions,
	}
}
