import { TaskPhase } from "./TaskPhase"
import type {
	TaskSnapshot,
	TaskSnapshotApproval,
	TaskSnapshotAwaiting,
	TaskSnapshotCancel,
	TaskSnapshotErrorRecovery,
	TaskSnapshotExecution,
	TaskSnapshotResume,
} from "./TaskSnapshot"

// ── Types ──

/** Describes a rejected task phase transition. */
export interface TaskTransitionError {
	code: "invalid_phase_transition"
	from: TaskPhase
	to: TaskPhase
}

/** Result returned for every requested task phase transition. */
export type TaskTransitionResult = { accepted: true; snapshot: TaskSnapshot } | { accepted: false; error: TaskTransitionError }

/**
 * Context passed to transition() when changing task phase.
 */
export interface TransitionContext {
	apiIndex: number
	awaiting?: TaskSnapshotAwaiting
	approval?: TaskSnapshotApproval
	execution?: TaskSnapshotExecution
	resume?: TaskSnapshotResume
	cancel?: TaskSnapshotCancel
	error?: TaskSnapshotErrorRecovery
	/** Callback invoked after transition to persist the state_snapshot. */
	onSnapshot?: (snapshot: TaskSnapshot) => Promise<void> | void
}

// ── TaskPhaseMachine ──

const ALLOWED_TRANSITIONS: Readonly<Record<TaskPhase, ReadonlySet<TaskPhase>>> = {
	[TaskPhase.IDLE]: new Set([TaskPhase.INITIALIZING]),
	[TaskPhase.INITIALIZING]: new Set([
		TaskPhase.WAITING_FOR_TASK,
		TaskPhase.STREAMING,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.ABORTED,
	]),
	[TaskPhase.WAITING_FOR_TASK]: new Set([TaskPhase.STREAMING, TaskPhase.CANCELLING, TaskPhase.ABORTED]),
	[TaskPhase.STREAMING]: new Set([
		TaskPhase.AWAITING_APPROVAL,
		TaskPhase.EXECUTING,
		TaskPhase.BETWEEN_TURNS,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.COMPLETED,
		TaskPhase.ABORTED,
	]),
	[TaskPhase.AWAITING_APPROVAL]: new Set([
		TaskPhase.EXECUTING,
		TaskPhase.BETWEEN_TURNS,
		TaskPhase.STREAMING,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.COMPLETED,
	]),
	[TaskPhase.EXECUTING]: new Set([
		TaskPhase.AWAITING_APPROVAL,
		TaskPhase.BETWEEN_TURNS,
		TaskPhase.STREAMING,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.COMPLETED,
	]),
	[TaskPhase.BETWEEN_TURNS]: new Set([
		TaskPhase.STREAMING,
		TaskPhase.AWAITING_APPROVAL,
		TaskPhase.EXECUTING,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.COMPLETED,
	]),
	[TaskPhase.RESUMING]: new Set([
		TaskPhase.AWAITING_APPROVAL,
		TaskPhase.EXECUTING,
		TaskPhase.STREAMING,
		TaskPhase.PAUSED,
		TaskPhase.CANCELLING,
		TaskPhase.ABORTED,
	]),
	[TaskPhase.CANCELLING]: new Set([TaskPhase.PAUSED, TaskPhase.ABORTED]),
	[TaskPhase.ABORTED]: new Set(),
	[TaskPhase.COMPLETED]: new Set([TaskPhase.STREAMING, TaskPhase.CANCELLING, TaskPhase.ABORTED]),
	[TaskPhase.PAUSED]: new Set([TaskPhase.RESUMING, TaskPhase.CANCELLING, TaskPhase.ABORTED]),
}

/**
 * Manages the top-level task lifecycle phase.
 * Extracted from TaskController — single source of truth for task state.
 */
export class TaskPhaseMachine {
	private _phase: TaskPhase = TaskPhase.IDLE

	get phase(): TaskPhase {
		return this._phase
	}

	/**
	 * Generate a snapshot of the current task state for persistence.
	 */
	snapshot(apiIndex: number, extra?: Partial<TaskSnapshot>): TaskSnapshot {
		return {
			phase: this._phase,
			apiIndex,
			timestamp: Date.now(),
			...extra,
		}
	}

	/** Return whether the current phase permits the requested target. */
	canTransition(to: TaskPhase): boolean {
		return ALLOWED_TRANSITIONS[this._phase].has(to)
	}

	/**
	 * Transition to a new task phase. This is the ONLY way to change phase.
	 * Automatically generates a snapshot and invokes the persist callback.
	 * Async to ensure snapshot persistence completes before returning.
	 */
	async transition(to: TaskPhase, ctx: TransitionContext): Promise<TaskTransitionResult> {
		if (!this.canTransition(to)) {
			return {
				accepted: false,
				error: { code: "invalid_phase_transition", from: this._phase, to },
			}
		}

		this._phase = to

		const snap = this.snapshot(ctx.apiIndex, {
			awaiting: ctx.awaiting,
			approval: ctx.approval,
			execution: ctx.execution,
			resume: ctx.resume,
			cancel: ctx.cancel,
			error: ctx.error,
		})

		await ctx.onSnapshot?.(snap)
		return { accepted: true, snapshot: snap }
	}

	/**
	 * Restore task phase from a previously persisted snapshot.
	 * Does NOT invoke onSnapshot (no re-persist).
	 */
	restoreFrom(snapshot: TaskSnapshot): void {
		this._phase = snapshot.phase
	}
}
