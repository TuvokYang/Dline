import type { ResumeEntry, ResumeInput, ResumeResult } from "./ResumeInput"
import { reconcileResume } from "./ResumeReconciler"

/** Explicit infrastructure boundary for deterministic resume coordination. */
export interface ResumeCoordinatorPorts {
	load(taskId: string): Promise<ResumeInput>
	persist(result: ResumeResult): Promise<void>
	hydrate(result: ResumeResult): Promise<void>
	dispatch(entry: ResumeEntry): Promise<void>
}

/** Runs the fixed resume transaction order around the pure reconciler. */
export class ResumeCoordinator {
	constructor(private readonly ports: ResumeCoordinatorPorts) {}

	/** Load, reconcile, persist, hydrate and dispatch exactly one resume entry. */
	async resume(taskId: string): Promise<ResumeResult> {
		const input = await this.ports.load(taskId)
		const result = reconcileResume(input)
		await this.ports.persist(result)
		await this.ports.hydrate(result)
		await this.ports.dispatch(
			result.entry.type === "read_only_failure" ? { ...result.entry, diagnostics: result.diagnostics } : result.entry,
		)
		return result
	}
}
