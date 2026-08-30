import type { TaskInputViewState, TaskViewAction, TaskViewState } from "@shared/ExtensionMessage"
import type { TaskRuntimeState } from "../runtime/TaskRuntimeState"
import { isTaskWorkingPhase } from "../TaskActivityPhases"
import { TaskPhase } from "../TaskPhase"
import { projectInteraction } from "./InteractionProjector"

const DISABLED_INPUT: TaskInputViewState = {
	enabled: false,
	acceptsText: false,
	acceptsImages: false,
	acceptsFiles: false,
}

const CANCELLING_ACTION: TaskViewAction = {
	type: "cancel",
	label: "Cancel",
	appearance: "danger",
	enabled: false,
	payloadPolicy: "none",
	dispatchTarget: "task",
}

const CANCEL_ACTION: TaskViewAction = { ...CANCELLING_ACTION, enabled: true }
const RETRY_PENDING_ACTION: TaskViewAction = {
	type: "retry",
	label: "Retry",
	appearance: "primary",
	enabled: true,
	payloadPolicy: "none",
	dispatchTarget: "task",
}

export interface TaskViewProjectionOptions {
	autoRetryActive?: boolean
	autoRetryPending?: boolean
	commandHandoffActivityId?: string
	commandHandoffRequested?: boolean
	contextCompactionOperationId?: string
	forceTruncateAvailable?: boolean
}

/** Project complete Webview state from backend-owned task state. */
export function projectTaskView(
	state: Readonly<TaskRuntimeState>,
	options: Readonly<TaskViewProjectionOptions> = {},
): TaskViewState {
	const contextCompaction = options.contextCompactionOperationId
		? { active: true as const, operationId: options.contextCompactionOperationId }
		: undefined
	if (state.phase === TaskPhase.CANCELLING) {
		return {
			taskId: state.taskId,
			phase: state.phase,
			stateRevision: state.revision,
			...(contextCompaction ? { contextCompaction } : {}),
			input: { ...DISABLED_INPUT },
			footer: { actions: [{ ...CANCELLING_ACTION }] },
		}
	}
	const interaction = state.interaction ? projectInteraction(state.interaction, state.revision) : undefined
	const diagnostic = state.interaction?.status === "opening" && !state.error ? undefined : interaction?.diagnostic
	const forceTruncateAvailable =
		options.forceTruncateAvailable === true &&
		state.interaction?.kind === "error_retry" &&
		state.interaction.status === "awaiting"
	// Cancel follows the one definition of "the loop is still working", so the
	// footer can never disagree with what the backend is willing to cancel.
	const isCancellable = isTaskWorkingPhase(state.phase)
	const interactionIsBeingResolved = state.interaction?.status === "resolving"
	// An interaction is created before its anchor is presented, so a long turn
	// can sit in `opening` indefinitely. Its own actions are projected disabled
	// in that window, and a disabled list is not `undefined`, so the task Cancel
	// fallback below never ran: a cancellable task lost its Cancel button until
	// the interaction reached `awaiting`. Offer Cancel instead, which is the
	// only action the backend can honour while the interaction is not ready.
	const interactionIsOpening = state.interaction?.status === "opening"
	const projectedActions =
		options.autoRetryActive && !state.interaction
			? [{ ...RETRY_PENDING_ACTION }, ...(isCancellable ? [{ ...CANCEL_ACTION }] : [])]
			: interactionIsBeingResolved
				? isCancellable
					? [{ ...CANCEL_ACTION }]
					: []
				: interactionIsOpening && isCancellable
					? [{ ...CANCEL_ACTION }]
					: (interaction?.actions ?? (isCancellable ? [{ ...CANCEL_ACTION }] : []))
	const commandHandoffAction: TaskViewAction | undefined = options.commandHandoffActivityId
		? {
				type: "continue_in_background",
				label: "Continue in Background",
				appearance: "secondary",
				enabled: options.commandHandoffRequested !== true,
				payloadPolicy: "none",
				dispatchTarget: "task",
				activityId: options.commandHandoffActivityId,
			}
		: undefined
	const actions = commandHandoffAction
		? projectedActions.flatMap((action) => (action.type === "cancel" ? [commandHandoffAction, action] : [action]))
		: projectedActions
	return {
		taskId: state.taskId,
		phase: state.phase,
		stateRevision: state.revision,
		activeInteraction: interaction?.view,
		...(diagnostic ? { diagnostic } : {}),
		...(contextCompaction ? { contextCompaction } : {}),
		...(forceTruncateAvailable ? { forceTruncateAvailable: true } : {}),
		// Only an active interaction opens the composer. A working task has
		// nobody waiting for a reply, so input must go to the queue instead of
		// being sent into the conversation as an answer to a question that was
		// never asked.
		input: interaction?.input ?? { ...DISABLED_INPUT },
		footer: { actions },
	}
}
