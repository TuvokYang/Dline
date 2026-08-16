export class SettingsRequestTracker {
	private readonly pendingRequests = new Set<Promise<unknown>>()
	private readonly latestRequestIds = new Map<string, number>()
	private readonly failures = new Map<string, unknown>()
	private nextRequestId = 0

	track<T>(requestKeys: readonly string[], request: Promise<T>, errorMessage: string): Promise<T> {
		const requestId = ++this.nextRequestId
		for (const requestKey of requestKeys) {
			this.latestRequestIds.set(requestKey, requestId)
		}

		const tracked = request.then(
			(value) => {
				for (const requestKey of requestKeys) {
					if (this.latestRequestIds.get(requestKey) === requestId) {
						this.failures.delete(requestKey)
					}
				}
				return value
			},
			(error: unknown) => {
				console.error(errorMessage, error)
				for (const requestKey of requestKeys) {
					if (this.latestRequestIds.get(requestKey) === requestId) {
						this.failures.set(requestKey, error)
					}
				}
				throw error
			},
		)

		this.pendingRequests.add(tracked)
		void tracked.finally(() => this.pendingRequests.delete(tracked)).catch(() => undefined)
		return tracked
	}

	async flush(): Promise<void> {
		while (this.pendingRequests.size > 0) {
			await Promise.allSettled([...this.pendingRequests])
		}

		const failures = [...new Set(this.failures.values())]
		if (failures.length === 1) {
			throw failures[0]
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, "Multiple Settings updates failed")
		}
	}
}
