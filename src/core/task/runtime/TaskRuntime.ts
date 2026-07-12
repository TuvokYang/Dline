import type { TaskEffectPorts } from "./TaskEffectRunner"
import { TaskEffectError, TaskEffectRunner } from "./TaskEffectRunner"
import type { TaskEvent } from "./TaskEvent"
import { reduceTask, type TransitionResult } from "./TaskReducer"
import type { TaskRuntimeState } from "./TaskRuntimeState"

/** Dispatch result returned after state commit and effect processing. */
export type TaskDispatchResult = TransitionResult & {
	effectError?: {
		effectId: string
		effectType: TaskEffectError["effect"]["type"]
		message: string
	}
}

/** Observer notified after one event and any derived presentation event commit. */
export type TaskRuntimeObserver = (event: TaskEvent, result: TaskDispatchResult) => void

/** Owns the task runtime aggregate and serializes all event dispatches. */
export class TaskRuntime {
	private state: TaskRuntimeState
	private readonly runner: TaskEffectRunner
	private readonly observers = new Set<TaskRuntimeObserver>()
	private queue: Promise<void> = Promise.resolve()

	constructor(initialState: TaskRuntimeState, ports: TaskEffectPorts) {
		this.state = initialState
		this.runner = new TaskEffectRunner(ports)
	}

	/** Replace runtime state only with an already validated resume aggregate. */
	restore(state: TaskRuntimeState): void {
		this.state = state
	}

	/** Return the current committed runtime aggregate. */
	getState(): Readonly<TaskRuntimeState> {
		return this.state
	}

	/** Subscribe to committed runtime events. */
	subscribe(observer: TaskRuntimeObserver): () => void {
		this.observers.add(observer)
		return () => this.observers.delete(observer)
	}

	/** Serialize one event transition and its ordered effects. */
	dispatch(event: TaskEvent): Promise<TaskDispatchResult> {
		const operation = this.queue.then(() => this.dispatchOne(event))
		this.queue = operation.then(
			() => undefined,
			() => undefined,
		)
		return operation
	}

	/** Commit one reduced state before executing its effects. */
	private async dispatchOne(event: TaskEvent): Promise<TaskDispatchResult> {
		const result = reduceTask(this.state, event)
		if (!result.accepted) {
			return result
		}

		this.state = result.next
		try {
			const anchors = await this.runner.run(result.effects, this.state)
			for (const anchor of anchors) {
				const interactionId = this.presentedInteractionId(event)
				if (interactionId) {
					await this.dispatchOne({
						type: "INTERACTION_PRESENTED",
						interactionId,
						messageTs: anchor.uiMessageTs,
					})
				}
			}
		} catch (error) {
			if (event.type === "EFFECT_FAILED") {
				throw error
			}
			if (!(error instanceof TaskEffectError)) {
				throw error
			}
			await this.dispatchOne({
				type: "EFFECT_FAILED",
				effectId: error.effect.id,
				effectType: error.effect.type,
				message: error.message,
			})
			const failed: TaskDispatchResult = {
				...result,
				accepted: false,
				effectError: {
					effectId: error.effect.id,
					effectType: error.effect.type,
					message: error.message,
				},
			}
			for (const observer of this.observers) {
				observer(event, failed)
			}
			return failed
		}
		for (const observer of this.observers) {
			observer(event, result)
		}
		return result
	}

	/** Return the interaction identity presented by one direct or composite lifecycle event. */
	private presentedInteractionId(event: TaskEvent): string | undefined {
		switch (event.type) {
			case "INTERACTION_OPEN_REQUESTED":
			case "API_RETRY_EXHAUSTED":
			case "ATTEMPT_COMPLETION_PRESENTED":
				return event.interactionId
			case "TASK_CANCELLED":
				return event.resume?.interactionId
			default:
				return undefined
		}
	}
}
