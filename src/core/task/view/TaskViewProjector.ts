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

const RECOVERY_RESUME_ACTION: TaskViewAction = {
	type: "resume",
	label: "Resume",
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

/** Project complete Webview state from the runtime aggregate only. */
export function projectTaskView(state: Readonly<TaskRuntimeState>): TaskViewState {
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
		interactionIsBeingResolved && isCancellable
			? [{ ...CANCEL_ACTION }]
			: (interaction?.actions ??
				(state.phase === TaskPhase.PAUSED
					? [{ ...RECOVERY_RESUME_ACTION }]
					: isCancellable
						? [{ ...CANCEL_ACTION }]
						: []))
	return {
		taskId: state.taskId,
		phase: state.phase,
		stateRevision: state.revision,
		activeInteraction: interaction?.view,
		input: interaction?.input ?? { ...DISABLED_INPUT },
		footer: { actions },
	}
}
