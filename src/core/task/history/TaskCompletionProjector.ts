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

/** Project canonical Task completion state into the durable task-history index. */
export class TaskCompletionProjector {
	private projection: TaskCompletionProjection

	constructor(private readonly options: TaskCompletionProjectorOptions) {
		this.projection = options.initial ?? { isCompleted: false, revision: -1 }
	}

	/** Persist one completion-state flip after its canonical Task snapshot is durable. */
	async sync(state: CompletionRuntimeState): Promise<boolean> {
		const isCompleted = state.phase === TaskPhase.COMPLETED && state.completion !== undefined
		if (state.revision <= this.projection.revision) {
			return false
		}
		if (isCompleted === this.projection.isCompleted) {
			this.projection = { isCompleted, revision: state.revision }
			return false
		}

		const persisted = await this.options.persist({
			taskId: this.options.taskId,
			isCompleted,
			revision: state.revision,
		})
		if (!persisted) {
			return false
		}

		this.projection = { isCompleted, revision: state.revision }
		return true
	}
}
