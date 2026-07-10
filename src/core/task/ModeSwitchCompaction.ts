export type ModeCompactResult = "completed" | "cancelled" | "failed"

interface ActiveCompaction {
	operationId: string
	complete: (result: ModeCompactResult) => void
	completion: Promise<ModeCompactResult>
	release: Promise<void>
	releaseNow: () => void
	completionDone: boolean
	releaseDone: boolean
}

/** Coordinate one forced source-mode compaction and its commit barrier. */
export class ModeSwitchCompaction {
	private active: ActiveCompaction | undefined

	/**
	 * Register one forced compaction and wake a pending conversational ask.
	 *
	 * @param operationId Coordinator operation identity.
	 * @param wakeAsk Callback that resolves a current conversational ask internally.
	 * @returns Final compaction result after summary application or failure.
	 */
	request(operationId: string, wakeAsk: () => void): Promise<ModeCompactResult> {
		if (this.active) {
			return Promise.resolve("failed")
		}
		let completeValue: ((result: ModeCompactResult) => void) | undefined
		let releaseValue: (() => void) | undefined
		const completion = new Promise<ModeCompactResult>((resolve) => {
			completeValue = resolve
		})
		const release = new Promise<void>((resolve) => {
			releaseValue = resolve
		})
		this.active = {
			operationId,
			completion,
			complete: (result) => completeValue?.(result),
			release,
			releaseNow: () => releaseValue?.(),
			completionDone: false,
			releaseDone: false,
		}
		wakeAsk()
		return completion
	}

	/**
	 * Report whether the next task turn must compact regardless of user settings.
	 *
	 * @returns True while an operation awaits summary application.
	 */
	shouldForce(): boolean {
		return Boolean(this.active && !this.active.completionDone)
	}

	/**
	 * Complete the operation after summary state is applied, then await mode commit release.
	 *
	 * @returns A promise held until Coordinator commits or fails the transaction.
	 */
	async markApplied(): Promise<void> {
		const active = this.active
		if (!active) {
			return
		}
		if (!active.completionDone) {
			active.completionDone = true
			active.complete("completed")
		}
		await active.release
		if (this.active === active) {
			this.active = undefined
		}
	}

	/**
	 * Release the task loop after target-mode commit.
	 *
	 * @param operationId Active Coordinator operation identity.
	 */
	release(operationId: string): void {
		const active = this.match(operationId)
		if (!active || active.releaseDone) {
			return
		}
		active.releaseDone = true
		active.releaseNow()
		if (active.completionDone && this.active === active) {
			this.active = undefined
		}
	}

	/**
	 * Fail the matching operation and release any pending task barrier.
	 *
	 * @param operationId Active Coordinator operation identity.
	 * @param _reason Internal diagnostic reason owned by the Coordinator snapshot.
	 */
	fail(operationId: string, _reason: string): void {
		const active = this.match(operationId)
		if (!active) {
			return
		}
		if (!active.completionDone) {
			active.completionDone = true
			active.complete("failed")
		}
		this.release(operationId)
	}

	/** Cancel the active compaction during task abort or termination. */
	abort(): void {
		const active = this.active
		if (!active) {
			return
		}
		if (!active.completionDone) {
			active.completionDone = true
			active.complete("cancelled")
		}
		this.release(active.operationId)
	}

	/**
	 * Return the active operation identity for lifecycle integration and tests.
	 *
	 * @returns Current operation ID, if any.
	 */
	getOperationId(): string | undefined {
		return this.active?.operationId
	}

	/** Return the active operation only when identity matches. */
	private match(operationId: string): ActiveCompaction | undefined {
		return this.active?.operationId === operationId ? this.active : undefined
	}
}
