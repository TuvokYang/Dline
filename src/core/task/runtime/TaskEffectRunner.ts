import type {
	AppendAskEffect,
	AppendSayEffect,
	ExecuteToolEffect,
	StartApiEffect,
	StartNewTaskEffect,
	StartSuccessorTaskEffect,
	TaskEffect,
} from "./TaskEffect"
import type { TaskRuntimeState } from "./TaskRuntimeState"

/** Anchor data returned after an ask presentation is persisted. */
export interface InteractionAnchorResult {
	uiMessageTs: number
}

/** Explicit infrastructure ports used by the task effect runner. */
export interface TaskEffectPorts {
	postView(state: Readonly<TaskRuntimeState>): Promise<void>
	persistSnapshot(state: Readonly<TaskRuntimeState>): Promise<void>
	cancelRuntime(): Promise<void>
	prepareResume(): Promise<void>
	startApi(effect: StartApiEffect): Promise<void>
	executeTool(effect: ExecuteToolEffect): Promise<void>
	appendSay(effect: AppendSayEffect): Promise<void>
	appendAsk(effect: AppendAskEffect): Promise<InteractionAnchorResult>
	startNewTask(effect: StartNewTaskEffect): Promise<void>
	/** Optional only for backward-compatible test ports that cannot start a successor. */
	startSuccessorTask?(effect: StartSuccessorTaskEffect): Promise<void>
}

/** Identifies one effect that failed while being executed. */
export class TaskEffectError extends Error {
	readonly effect: TaskEffect

	constructor(effect: TaskEffect, cause: Error) {
		super(cause.message, { cause })
		this.name = "TaskEffectError"
		this.effect = effect
	}
}

/** Executes data-only task effects in their declared order. */
export class TaskEffectRunner {
	constructor(private readonly ports: TaskEffectPorts) {}

	/** Run all effects serially against one committed state. */
	async run(effects: readonly TaskEffect[], state: Readonly<TaskRuntimeState>): Promise<InteractionAnchorResult[]> {
		const anchors: InteractionAnchorResult[] = []
		for (const effect of effects) {
			try {
				const anchor = await this.runOne(effect, state)
				if (anchor) {
					anchors.push(anchor)
				}
			} catch (error) {
				const cause = error instanceof Error ? error : new Error(String(error))
				throw new TaskEffectError(effect, cause)
			}
		}
		return anchors
	}

	/** Dispatch one effect to its explicit infrastructure port. */
	private async runOne(effect: TaskEffect, state: Readonly<TaskRuntimeState>): Promise<InteractionAnchorResult | undefined> {
		switch (effect.type) {
			case "POST_TASK_VIEW":
				await this.ports.postView(state)
				return
			case "PERSIST_SNAPSHOT":
				await this.ports.persistSnapshot(state)
				return
			case "CANCEL_RUNTIME":
				await this.ports.cancelRuntime()
				return
			case "PREPARE_RESUME":
				await this.ports.prepareResume()
				return
			case "START_API":
				await this.ports.startApi(effect)
				return
			case "EXECUTE_TOOL":
				await this.ports.executeTool(effect)
				return
			case "APPEND_SAY":
				await this.ports.appendSay(effect)
				return
			case "APPEND_ASK":
				return this.ports.appendAsk(effect)
			case "START_NEW_TASK":
				await this.ports.startNewTask(effect)
				return
			case "START_SUCCESSOR_TASK":
				if (!this.ports.startSuccessorTask) {
					throw new Error("Task runtime successor port is unavailable")
				}
				await this.ports.startSuccessorTask(effect)
				return
		}
	}
}
