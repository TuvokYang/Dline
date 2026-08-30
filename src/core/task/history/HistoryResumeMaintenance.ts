export type HistoryResumeMaintenanceStage =
	| "legacy storage cleanup"
	| "encrypted reasoning repair"
	| "interrupted activity recovery"
	| "interrupted command card recovery"
	| "task metadata refresh"
	| "context indicator refresh"

export interface HistoryResumeMaintenancePorts {
	cleanupLegacyStorage(): Promise<void>
	/** Remove duplicated encrypted reasoning snapshots persisted by earlier versions. */
	repairEncryptedReasoning(): Promise<void>
	recoverInterruptedActivities(): Promise<Iterable<string>>
	patchInterruptedCommandCards(activityIds: ReadonlySet<string>): Promise<void>
	refreshTaskMetadata(): Promise<void>
	refreshContextIndicator(): Promise<void>
	reportFailure(stage: HistoryResumeMaintenanceStage, error: unknown): void
}

/** Runs best-effort historical Task maintenance outside the Resume readiness path. */
export class HistoryResumeMaintenance {
	private running?: Promise<void>

	constructor(private readonly ports: HistoryResumeMaintenancePorts) {}

	/** Coalesce concurrent requests and stop between stages when the Task loses ownership. */
	run(isCurrent: () => boolean = () => true): Promise<void> {
		if (this.running) return this.running

		const run = this.runStages(isCurrent).finally(() => {
			if (this.running === run) this.running = undefined
		})
		this.running = run
		return run
	}

	private async runStages(isCurrent: () => boolean): Promise<void> {
		if (!isCurrent()) return
		await this.attempt("legacy storage cleanup", () => this.ports.cleanupLegacyStorage())

		// Repair before the metadata and context indicator stages so both observe the
		// repaired history rather than the oversized persisted one.
		if (!isCurrent()) return
		await this.attempt("encrypted reasoning repair", () => this.ports.repairEncryptedReasoning())

		if (!isCurrent()) return
		const interruptedActivityIds = await this.attempt("interrupted activity recovery", () =>
			this.ports.recoverInterruptedActivities(),
		)
		if (interruptedActivityIds !== undefined && isCurrent()) {
			await this.attempt("interrupted command card recovery", () =>
				this.ports.patchInterruptedCommandCards(new Set(interruptedActivityIds)),
			)
		}

		if (!isCurrent()) return
		await this.attempt("task metadata refresh", () => this.ports.refreshTaskMetadata())

		if (!isCurrent()) return
		await this.attempt("context indicator refresh", () => this.ports.refreshContextIndicator())
	}

	private async attempt<T>(stage: HistoryResumeMaintenanceStage, operation: () => Promise<T>): Promise<T | undefined> {
		try {
			return await operation()
		} catch (error) {
			try {
				this.ports.reportFailure(stage, error)
			} catch {
				// Diagnostics must never turn optional maintenance into a readiness failure.
			}
			return undefined
		}
	}
}
