export interface HistoryTaskReadinessOptions {
	displayHistory: () => Promise<void>
	prepareFromHistory: (options: { onReadyToDisplay?: () => Promise<void>; isCurrent?: () => boolean }) => Promise<void>
	hasTaskLock: boolean
	isCurrent: () => boolean
	onReadyToDisplay?: () => Promise<void>
}

/**
 * Loads one historical Task and preserves its identity across readiness effects.
 * Returns whether the same Task still owns the Controller surface.
 */
export async function prepareHistoryTaskForDisplay(options: HistoryTaskReadinessOptions): Promise<boolean> {
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
