import type { TaskInputViewState, TaskViewAction, TaskViewState } from "@shared/ExtensionMessage"
import type { TaskRuntimeState } from "../runtime/TaskRuntimeState"
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

const CANCELLABLE_PHASES = new Set<TaskPhase>([
	TaskPhase.INITIALIZING,
	TaskPhase.STREAMING,
	TaskPhase.EXECUTING,
	TaskPhase.BETWEEN_TURNS,
	TaskPhase.RESUMING,
])

export interface TaskViewProjectionOptions {
	autoRetryActive?: boolean
	autoRetryPending?: boolean
}

/** Project complete Webview state from backend-owned task state. */
export function projectTaskView(
	state: Readonly<TaskRuntimeState>,
	options: Readonly<TaskViewProjectionOptions> = {},
): TaskViewState {
	if (state.phase === TaskPhase.CANCELLING) {
		return {
			taskId: state.taskId,
			phase: state.phase,
			stateRevision: state.revision,
			input: { ...DISABLED_INPUT },
			footer: { actions: [{ ...CANCELLING_ACTION }] },
		}
	}

	const interaction = state.interaction ? projectInteraction(state.interaction, state.revision) : undefined
	const isCancellable = CANCELLABLE_PHASES.has(state.phase)
	const interactionIsBeingResolved = state.interaction?.status === "resolving"
	const actions =
		options.autoRetryActive && !state.interaction
			? [
					{ ...RETRY_PENDING_ACTION, enabled: options.autoRetryPending ?? true },
					...(isCancellable ? [{ ...CANCEL_ACTION }] : []),
				]
			: interactionIsBeingResolved
				? isCancellable
					? [{ ...CANCEL_ACTION }]
					: []
				: (interaction?.actions ?? (isCancellable ? [{ ...CANCEL_ACTION }] : []))
	return {
		taskId: state.taskId,
		phase: state.phase,
		stateRevision: state.revision,
		activeInteraction: interaction?.view,
		input: interaction?.input ?? { ...DISABLED_INPUT },
		footer: { actions },
	}
}
