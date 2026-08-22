import type { ClineUserContent } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { StartSuccessorTaskPostCommitDirective } from "../tools/ToolExecutionResult"

/** Task-local bindings intentionally inherited by an independent New Task successor. */
export interface NewTaskInheritedSettings {
	readonly mode: Mode
	readonly planModeProfileId?: string
	readonly planModeProfile?: string
	readonly actModeProfileId?: string
	readonly actModeProfile?: string
}

/** Canonical identity of the New Task declaration consumed by the old Task. */
export interface NewTaskConsumedState {
	readonly functionId: string
	readonly dlineTid: string
}

/** User feedback carried into the successor Task's initial Provider input. */
export interface NewTaskFeedback {
	readonly text: string
	readonly images: readonly string[]
	readonly files: readonly string[]
}

/** Complete one-shot data required by the current Controller to start the successor Task. */
export interface NewTaskHandoff {
	readonly context: string
	readonly source: NewTaskConsumedState
	readonly initialUserContent: readonly ClineUserContent[]
	readonly taskSettings: NewTaskInheritedSettings
}

/** Read-only source for capturing task-local bindings without global active-task routing. */
export interface NewTaskSettingsSource {
	readonly mode: Mode
	readonly planModeProfileId?: string
	readonly planModeProfile?: string
	readonly actModeProfileId?: string
	readonly actModeProfile?: string
}

/** Snapshot a successor directive, prepared feedback content, and current Task-local settings. */
export function createNewTaskHandoff(
	directive: StartSuccessorTaskPostCommitDirective,
	source: NewTaskSettingsSource,
	initialUserContent: readonly ClineUserContent[],
): NewTaskHandoff {
	return {
		context: directive.context,
		source: {
			functionId: directive.functionId,
			dlineTid: directive.dlineTid,
		},
		initialUserContent: [...initialUserContent],
		taskSettings: {
			mode: source.mode,
			...(source.planModeProfileId === undefined ? {} : { planModeProfileId: source.planModeProfileId }),
			...(source.planModeProfile === undefined ? {} : { planModeProfile: source.planModeProfile }),
			...(source.actModeProfileId === undefined ? {} : { actModeProfileId: source.actModeProfileId }),
			...(source.actModeProfile === undefined ? {} : { actModeProfile: source.actModeProfile }),
		},
	}
}
