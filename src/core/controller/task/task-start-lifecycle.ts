export interface TaskStartLifecycleOptions {
	taskId: string
	startInBackground: boolean
	beforeStart?: (taskId: string) => Promise<void> | void
	start: () => Promise<void>
	onBackgroundError: (error: unknown) => Promise<void> | void
}

/**
 * Admits a task start after its identity-dependent setup has completed.
 * Foreground starts preserve the existing await semantics. Background starts
 * return after admission while retaining an observed rejection path.
 */
export async function startTaskLifecycle(options: TaskStartLifecycleOptions): Promise<void> {
	await options.beforeStart?.(options.taskId)

	if (!options.startInBackground) {
		await options.start()
		return
	}

	let startPromise: Promise<void>
	try {
		startPromise = options.start()
	} catch (error) {
		await options.onBackgroundError(error)
		return
	}

	void startPromise.catch((error: unknown) => {
		void Promise.resolve(options.onBackgroundError(error)).catch(() => undefined)
	})
}
