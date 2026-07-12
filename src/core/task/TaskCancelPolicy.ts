import type { InteractionKind } from "./interaction/Interaction"
import type { CancelSource, TaskRuntimeState } from "./runtime/TaskRuntimeState"
import { TaskPhase } from "./TaskPhase"

/** Observable runtime activity that is not represented by the aggregate phase alone. */
export interface TaskCancelActivity {
	hasActiveHook: boolean
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	hasActiveBackgroundCommand: boolean
}

/** Inputs for the runtime-owned TaskCancel hook policy. */
export interface TaskCancelPolicyInput {
	runtime: Readonly<TaskRuntimeState>
	source: CancelSource
	activity: Readonly<TaskCancelActivity>
}

const USER_WAIT_INTERACTIONS = new Set<InteractionKind>(["resume", "completion"])
const ACTIVE_PHASES = new Set<TaskPhase>([
	TaskPhase.INITIALIZING,
	TaskPhase.STREAMING,
	TaskPhase.EXECUTING,
	TaskPhase.BETWEEN_TURNS,
	TaskPhase.RESUMING,
])

/** Decide whether cancellation interrupts work without consulting UI message history. */
export function shouldRunTaskCancelHook(input: TaskCancelPolicyInput): boolean {
	if (input.source === "hook") {
		return false
	}
	if (
		input.activity.hasActiveHook ||
		input.activity.isStreaming ||
		input.activity.isWaitingForFirstChunk ||
		input.activity.hasActiveBackgroundCommand
	) {
		return true
	}
	const interaction = input.runtime.interaction
	if (interaction && USER_WAIT_INTERACTIONS.has(interaction.kind)) {
		return false
	}
	return ACTIVE_PHASES.has(input.runtime.phase)
}
