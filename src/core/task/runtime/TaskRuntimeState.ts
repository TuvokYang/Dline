import type { BlockLifecycle } from "../BlockPhaseMachine"
import type { ActiveInteraction } from "../interaction/InteractionReducer"
import { TaskPhase } from "../TaskPhase"
import type { TaskEffectType } from "./TaskEffect"

/** Persistent anchors that locate the runtime state in UI and API history. */
export interface TaskAnchor {
	apiIndex: number
	uiMessageTs?: number
	turnId?: string
	interactionId?: string
}

/** Source and origin phase for an in-progress cancellation. */
export interface TaskCancellationState {
	source: CancelSource
	fromPhase: TaskPhase
}

/** Runtime diagnostic produced by a failed effect. */
export interface TaskRuntimeError {
	effectId: string
	effectType: TaskEffectType
	message: string
}

/** Completion identity retained while completion is visible. */
export interface TaskCompletionState {
	completionId: string
}

/** Canonical state for one assistant turn and its tool blocks. */
export interface TurnState {
	turnId: string
	assistantApiIndex: number
	blocks: BlockLifecycle[]
	activeDlineTid?: string
	mode: "serial" | "parallel"
}

/** Aggregate runtime state used by the pure task reducer. */
export interface TaskRuntimeState {
	taskId: string
	phase: TaskPhase
	revision: number
	anchor: TaskAnchor
	turn?: TurnState
	interaction?: ActiveInteraction
	cancellation?: TaskCancellationState
	error?: TaskRuntimeError
	completion?: TaskCompletionState
}

/** Supported sources for task cancellation. */
export type CancelSource = "user" | "hook" | "system"

/** Parameters used to construct a task runtime aggregate. */
export interface CreateTaskRuntimeStateOptions {
	taskId: string
	phase?: TaskPhase
	revision?: number
	anchor?: TaskAnchor
}

/** Create a normalized task runtime aggregate. */
export function createTaskRuntimeState(options: CreateTaskRuntimeStateOptions): TaskRuntimeState {
	return {
		taskId: options.taskId,
		phase: options.phase ?? TaskPhase.IDLE,
		revision: options.revision ?? 0,
		anchor: options.anchor ?? { apiIndex: -1 },
	}
}
