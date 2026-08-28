import { Logger } from "@shared/services/Logger"

export type PromptFreshnessInvalidationSource =
	| "prompt_input_file"
	| "task_capability_toggle"
	| "capability_mutation"
	| "remote_config"
	| "mcp_registry"
	| "settings"

export interface PromptFreshnessInvalidationCoordinatorDeps {
	readonly reevaluate: () => Promise<void>
	readonly publishState: () => Promise<void>
	readonly debounceMs?: number
}

/** Coalesce prompt-input changes into ordered, Task-local freshness projections. */
export class PromptFreshnessInvalidationCoordinator {
	private readonly reevaluate: () => Promise<void>
	private readonly publishState: () => Promise<void>
	private readonly debounceMs: number
	private debounceTimer?: NodeJS.Timeout
	private runPromise?: Promise<void>
	private pending = false
	private disposed = false

	constructor(deps: PromptFreshnessInvalidationCoordinatorDeps) {
		this.reevaluate = deps.reevaluate
		this.publishState = deps.publishState
		this.debounceMs = deps.debounceMs ?? 200
	}

	/** Schedule a debounced freshness projection for a non-durable external signal. */
	invalidate(_source: PromptFreshnessInvalidationSource): void {
		if (this.disposed) return
		this.pending = true
		if (this.debounceTimer) clearTimeout(this.debounceTimer)
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined
			void this.run().catch((error) => {
				Logger.error("[PromptFreshness] Failed to process invalidation:", error)
			})
		}, this.debounceMs)
	}

	/** Run and await all currently pending freshness projections. */
	flush(_source: PromptFreshnessInvalidationSource): Promise<void> {
		if (this.disposed) return Promise.resolve()
		this.pending = true
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = undefined
		}
		return this.run()
	}

	dispose(): void {
		this.disposed = true
		this.pending = false
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = undefined
		}
	}

	private run(): Promise<void> {
		if (this.runPromise) return this.runPromise
		const run = this.drain()
		this.runPromise = run.finally(() => {
			if (this.runPromise === run || this.runPromise === settled) this.runPromise = undefined
		})
		const settled = this.runPromise
		return settled
	}

	private async drain(): Promise<void> {
		while (this.pending && !this.disposed) {
			this.pending = false
			await this.reevaluate()
			if (this.disposed) return
			await this.publishState()
		}
	}
}
