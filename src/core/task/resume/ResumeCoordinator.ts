import type { ResumeEntry, ResumeInput, ResumeResult } from "./ResumeInput"
import { reconcileResume } from "./ResumeReconciler"

/** Explicit infrastructure boundary for deterministic resume coordination. */
export interface ResumeCoordinatorPorts {
	load(taskId: string): Promise<ResumeInput>
	persist(result: ResumeResult): Promise<void>
	hydrate(result: ResumeResult): Promise<void>
	publishView(result: ResumeResult): Promise<void>
	dispatch(entry: ResumeEntry): Promise<void>
}

/** Runs the fixed resume transaction order around the pure reconciler. */
export class ResumeCoordinator {
	private readonly inFlightByTaskId = new Map<string, Promise<ResumeResult>>()

	constructor(private readonly ports: ResumeCoordinatorPorts) {}

	/** Coalesce concurrent attempts and run one complete resume transaction per task. */
	resume(taskId: string): Promise<ResumeResult> {
		const inFlight = this.inFlightByTaskId.get(taskId)
		if (inFlight) return inFlight

		const transaction = this.runTransaction(taskId).finally(() => {
			if (this.inFlightByTaskId.get(taskId) === transaction) {
				this.inFlightByTaskId.delete(taskId)
			}
		})
		this.inFlightByTaskId.set(taskId, transaction)
		return transaction
	}

	/** Load, reconcile, persist, hydrate, publish and dispatch exactly one resume entry. */
	private async runTransaction(taskId: string): Promise<ResumeResult> {
		const input = await this.ports.load(taskId)
		const result = reconcileResume(input)
		await this.ports.persist(result)
		await this.ports.hydrate(result)
		await this.ports.publishView(result)
		await this.ports.dispatch(
			result.entry.type === "read_only_failure" ? { ...result.entry, diagnostics: result.diagnostics } : result.entry,
		)
		return result
	}
}
