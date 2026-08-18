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
	if (state.profileInvalid) {
		return {
			taskId: state.taskId,
			phase: state.phase,
			stateRevision: state.revision,
			profileInvalid: { ...state.profileInvalid },
			...(contextCompaction ? { contextCompaction } : {}),
			input: { ...DISABLED_INPUT },
			footer: { actions: [] },
		}
	}

	const interaction = state.interaction ? projectInteraction(state.interaction, state.revision) : undefined
	const diagnostic = state.interaction?.status === "opening" && !state.error ? undefined : interaction?.diagnostic
	const forceTruncateAvailable =
		options.forceTruncateAvailable === true &&
		state.interaction?.kind === "error_retry" &&
		state.interaction.status === "awaiting"
	const isCancellable = CANCELLABLE_PHASES.has(state.phase)
	const interactionIsBeingResolved = state.interaction?.status === "resolving"
	const projectedActions =
		options.autoRetryActive && !state.interaction
			? [{ ...RETRY_PENDING_ACTION }, ...(isCancellable ? [{ ...CANCEL_ACTION }] : [])]
			: interactionIsBeingResolved
				? isCancellable
					? [{ ...CANCEL_ACTION }]
					: []
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
		? projectedActions.map((action) => (action.type === "cancel" ? commandHandoffAction : action))
		: projectedActions
	return {
		taskId: state.taskId,
		phase: state.phase,
		stateRevision: state.revision,
		activeInteraction: interaction?.view,
		...(diagnostic ? { diagnostic } : {}),
		...(contextCompaction ? { contextCompaction } : {}),
		...(forceTruncateAvailable ? { forceTruncateAvailable: true } : {}),
		input: interaction?.input ?? { ...DISABLED_INPUT },
		footer: { actions },
	}
}
