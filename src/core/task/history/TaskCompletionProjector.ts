import type { TaskRuntimeState } from "../runtime/TaskRuntimeState"
import { TaskPhase } from "../TaskPhase"

export interface TaskCompletionProjection {
	isCompleted: boolean
	revision: number
}

export interface TaskCompletionProjectionUpdate extends TaskCompletionProjection {
	taskId: string
}

export interface TaskCompletionProjectorOptions {
	taskId: string
	initial?: TaskCompletionProjection
	persist(update: TaskCompletionProjectionUpdate): Promise<boolean>
}

type CompletionRuntimeState = Pick<TaskRuntimeState, "phase" | "completion" | "revision">

/**
 * Phases that carry no settled completion verdict.
 *
 * Reopening a finished Task walks through startup phases before its canonical
 * state is hydrated. Treating those transient states as "not completed" made
 * every reopen persist `isCompleted: false`, which is why history checkmarks
 * disappeared after a few refreshes.
 */
const INDETERMINATE_PHASES: ReadonlySet<TaskPhase> = new Set([
	TaskPhase.IDLE,
	TaskPhase.INITIALIZING,
	TaskPhase.WAITING_FOR_TASK,
	TaskPhase.RESUMING,
])

/** Project canonical Task completion state into the durable task-history index. */
export class TaskCompletionProjector {
	private isCompleted: boolean
	/**
	 * Highest durable revision this projector knows about.
	 *
	 * Runtime revisions restart per Task session, so a durable revision from an
	 * earlier session can exceed every revision the current session produces.
	 * Persisted revisions are therefore lifted above this watermark to stay
	 * monotonic for the durable store.
	 */
	private persistedRevision: number
	/** Highest runtime revision observed in the current session; guards out-of-order syncs. */
	private runtimeRevision = -1

	constructor(private readonly options: TaskCompletionProjectorOptions) {
		this.isCompleted = options.initial?.isCompleted ?? false
		this.persistedRevision = options.initial?.revision ?? -1
	}

	/** Persist one completion-state flip after its canonical Task snapshot is durable. */
	async sync(state: CompletionRuntimeState): Promise<boolean> {
		if (INDETERMINATE_PHASES.has(state.phase)) {
			return false
		}
		if (state.revision <= this.runtimeRevision) {
			return false
		}

		const isCompleted = state.phase === TaskPhase.COMPLETED && state.completion !== undefined
		if (isCompleted === this.isCompleted) {
			this.runtimeRevision = state.revision
			return false
		}

		const revision = Math.max(state.revision, this.persistedRevision + 1)
		const persisted = await this.options.persist({
			taskId: this.options.taskId,
			isCompleted,
			revision,
		})
		if (!persisted) {
			return false
		}

		this.isCompleted = isCompleted
		this.runtimeRevision = state.revision
		this.persistedRevision = revision
		return true
	}
}
