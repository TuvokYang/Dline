import type { TaskViewState } from "@shared/ExtensionMessage"

export interface HistoryTaskReadinessOptions {
	displayHistory: () => Promise<void>
	onPreparingToDisplay?: () => Promise<void>
	prepareFromHistory: (options: { onReadyToDisplay?: () => Promise<void>; isCurrent?: () => boolean }) => Promise<void>
	hasTaskLock: boolean
	isCurrent: () => boolean
	onReadyToDisplay?: () => Promise<void>
}

/** Project a visible but non-dispatchable Resume surface while canonical identity is restored. */
export function projectHistoryPreparingView(state: {
	taskId: string
	phase: TaskViewState["phase"]
	revision: number
}): TaskViewState {
	return {
		taskId: state.taskId,
		phase: state.phase,
		stateRevision: state.revision,
		input: { enabled: false, acceptsText: false, acceptsImages: false, acceptsFiles: false },
		footer: {
			actions: [
				{
					type: "resume",
					label: "Resume",
					appearance: "primary",
					enabled: false,
					payloadPolicy: "draft",
					dispatchTarget: "interaction",
				},
			],
		},
	}
}

/**
 * Loads one historical Task and preserves its identity across readiness effects.
 * Returns whether the same Task still owns the Controller surface.
 */
export async function prepareHistoryTaskForDisplay(options: HistoryTaskReadinessOptions): Promise<boolean> {
	await options.onPreparingToDisplay?.()
	if (!options.isCurrent()) return false
	await options.displayHistory()
	if (!options.isCurrent()) return false

	let readyNotified = false
	const notifyReady = async (): Promise<void> => {
		if (readyNotified || !options.isCurrent()) return
		readyNotified = true
		await options.onReadyToDisplay?.()
	}
	if (!options.hasTaskLock) {
		await notifyReady()
		return options.isCurrent()
	}

	await options.prepareFromHistory({
		isCurrent: options.isCurrent,
		onReadyToDisplay: notifyReady,
	})
	return options.isCurrent()
}
