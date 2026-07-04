import { TaskPhase } from "./TaskPhase"
import type { TaskSnapshot, TaskSnapshotApproval, TaskSnapshotExecution, TaskSnapshotResume, TaskSnapshotCancel } from "./TaskSnapshot"

// ── Types ──

/**
 * Context passed to transition() when changing task phase.
 */
export interface TransitionContext {
	apiIndex: number
	approval?: TaskSnapshotApproval
	execution?: TaskSnapshotExecution
	resume?: TaskSnapshotResume
	cancel?: TaskSnapshotCancel
	/** Callback invoked after transition to persist the state_snapshot. */
	onSnapshot?: (snapshot: TaskSnapshot) => void
}

// ── TaskPhaseMachine ──

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

	/**
	 * Transition to a new task phase. This is the ONLY way to change phase.
	 * Automatically generates a snapshot and invokes the persist callback.
	 */
	transition(to: TaskPhase, ctx: TransitionContext): TaskSnapshot {
		this._phase = to

		const snap = this.snapshot(ctx.apiIndex, {
			approval: ctx.approval,
			execution: ctx.execution,
			resume: ctx.resume,
			cancel: ctx.cancel,
		})

		ctx.onSnapshot?.(snap)
		return snap
	}

	/**
	 * Restore task phase from a previously persisted snapshot.
	 * Does NOT invoke onSnapshot (no re-persist).
	 */
	restoreFrom(snapshot: TaskSnapshot): void {
		this._phase = snapshot.phase
	}
}
