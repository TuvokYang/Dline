import { decideModeSwitch } from "@core/context/context-management/context-pressure"
import type { ModeSwitchRequestResult, ModeSwitchSnapshot } from "@shared/mode-switch"
import type {
	ContextPressureReader,
	ModeCommitPort,
	ModeProfileResolver,
	ModeSwitchOperation,
	ModeSwitchRequest,
	TaskCompactionPort,
} from "./types"

interface ModeSwitchDeps {
	profiles: ModeProfileResolver
	pressure: ContextPressureReader
	compaction: TaskCompactionPort
	commit: ModeCommitPort
	postState: () => Promise<void>
	createId: () => string
	getTaskId: () => string | undefined
}

/** Coordinate one task-local mode-switch transaction through explicit phases. */
export class ModeSwitchCoordinator {
	private snapshot: ModeSwitchSnapshot = { phase: "idle" }
	private operation: ModeSwitchOperation | undefined

	/**
	 * Create a task-local mode-switch coordinator.
	 *
	 * @param deps Narrow runtime ports used by the transaction state machine.
	 */
	constructor(private readonly deps: ModeSwitchDeps) {}

	/**
	 * Request a direct or confirmation-gated mode switch.
	 *
	 * @param input Target mode, task identity, and pending draft content.
	 * @returns Typed request status and operation identity.
	 */
	async request(input: ModeSwitchRequest): Promise<ModeSwitchRequestResult> {
		if (this.snapshot.phase === "failed") {
			await this.clearState()
		}
		if (this.snapshot.phase !== "idle") {
			return { status: "in_progress", operationId: this.operation?.operationId }
		}
		if (this.deps.getTaskId() !== input.taskId) {
			return this.reject("Active task changed before mode switch request.")
		}

		const source = this.deps.profiles.getSource()
		const target = this.deps.profiles.resolve(input.targetMode)
		if (!source || !target || source.contextWindow <= 0 || target.contextWindow <= 0) {
			return this.reject("Unable to resolve effective mode profiles and context windows.")
		}

		const currentTokens = this.deps.pressure.read()
		const decision = decideModeSwitch({
			sourceProfile: source.profile,
			targetProfile: target.profile,
			sourceWindow: source.contextWindow,
			targetWindow: target.contextWindow,
			currentTokens,
		})
		const operation: ModeSwitchOperation = {
			operationId: this.deps.createId(),
			taskId: input.taskId,
			source,
			target,
			currentTokens,
			triggerTokens: decision.kind === "confirm" ? decision.triggerTokens : 0,
			chatContent: input.chatContent,
		}
		this.operation = operation

		if (decision.kind === "confirm") {
			await this.setSnapshot(this.createSnapshot(operation, "awaiting_confirmation"))
			return { status: "confirmation_required", operationId: operation.operationId }
		}
		return this.commitOperation(operation, false)
	}

	/**
	 * Confirm the active operation and compact before target-mode commit.
	 *
	 * @param operationId Operation identity returned by the original request.
	 * @returns Typed terminal or rejected result.
	 */
	async confirm(operationId: string): Promise<ModeSwitchRequestResult> {
		const operation = this.getActive(operationId, "awaiting_confirmation")
		if (!operation) {
			return this.reject("Mode switch confirmation is stale.", operationId)
		}
		if (this.deps.getTaskId() !== operation.taskId) {
			return this.failOperation(operation, "Active task changed before compaction.")
		}
		if (!this.deps.commit.validate(operation)) {
			return this.failOperation(operation, "Source mode or profile changed before compaction.")
		}

		await this.setSnapshot(this.createSnapshot(operation, "compacting"))
		const compactResult = await this.deps.compaction.compact(operation.operationId)
		if (compactResult !== "completed") {
			const reason = compactResult === "cancelled" ? "Mode switch compaction cancelled." : "Mode switch compaction failed."
			return this.failOperation(operation, reason)
		}
		return this.commitOperation(operation, true)
	}

	/**
	 * Cancel the active awaiting-confirmation operation.
	 *
	 * @param operationId Operation identity returned by the original request.
	 * @returns Rejected cancellation result or stale-operation rejection.
	 */
	async cancel(operationId: string): Promise<ModeSwitchRequestResult> {
		const operation = this.getActive(operationId, "awaiting_confirmation")
		if (!operation) {
			return this.reject("Mode switch cancellation is stale.", operationId)
		}
		await this.clearState()
		return { status: "rejected", operationId, error: "Mode switch cancelled." }
	}

	/**
	 * Return a detached read-only transaction snapshot.
	 *
	 * @returns Current task-local mode-switch state.
	 */
	getSnapshot(): ModeSwitchSnapshot {
		return { ...this.snapshot }
	}

	/**
	 * Release resources and clear the active operation during task lifecycle cleanup.
	 *
	 * @param reason Optional internal reset reason.
	 * @returns A promise that resolves after idle state is published.
	 */
	async reset(reason = "Mode switch reset."): Promise<void> {
		if (this.operation) {
			this.deps.compaction.fail(this.operation.operationId, reason)
			this.deps.compaction.release(this.operation.operationId)
		}
		await this.clearState()
	}

	/** Return the active operation only when identity and phase match. */
	private getActive(operationId: string, phase: ModeSwitchSnapshot["phase"]): ModeSwitchOperation | undefined {
		if (this.snapshot.phase !== phase || this.operation?.operationId !== operationId) {
			return undefined
		}
		return this.operation
	}

	/** Commit target mode, then release any source-mode compaction barrier. */
	private async commitOperation(operation: ModeSwitchOperation, releaseBarrier: boolean): Promise<ModeSwitchRequestResult> {
		if (this.deps.getTaskId() !== operation.taskId || !this.deps.commit.validate(operation)) {
			return this.failOperation(operation, "Mode switch state changed before commit.", releaseBarrier)
		}
		await this.setSnapshot(this.createSnapshot(operation, "committing"))
		try {
			await this.deps.commit.commit(operation)
			if (releaseBarrier) {
				this.deps.compaction.release(operation.operationId)
			}
			await this.clearState()
			return { status: "switched", operationId: operation.operationId }
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Mode switch commit failed."
			this.deps.compaction.fail(operation.operationId, reason)
			if (releaseBarrier) {
				this.deps.compaction.release(operation.operationId)
			}
			return this.failOperation(operation, reason)
		}
	}

	/** Publish a failed terminal state without changing source mode. */
	private async failOperation(
		operation: ModeSwitchOperation,
		reason: string,
		releaseBarrier = false,
	): Promise<ModeSwitchRequestResult> {
		if (releaseBarrier) {
			this.deps.compaction.release(operation.operationId)
		}
		await this.setSnapshot({ ...this.createSnapshot(operation, "failed"), error: reason })
		return { status: "rejected", operationId: operation.operationId, error: reason }
	}

	/** Build a projected snapshot without exposing pending chat content. */
	private createSnapshot(operation: ModeSwitchOperation, phase: ModeSwitchSnapshot["phase"]): ModeSwitchSnapshot {
		return {
			phase,
			operationId: operation.operationId,
			taskId: operation.taskId,
			sourceMode: operation.source.mode,
			targetMode: operation.target.mode,
			sourceProfile: operation.source.profile,
			targetProfile: operation.target.profile,
			sourceContextWindow: operation.source.contextWindow,
			targetContextWindow: operation.target.contextWindow,
			currentTokens: operation.currentTokens,
			triggerTokens: operation.triggerTokens,
		}
	}

	/** Apply one validated phase transition and publish state. */
	private async setSnapshot(snapshot: ModeSwitchSnapshot): Promise<void> {
		this.snapshot = snapshot
		await this.deps.postState()
	}

	/** Clear operation data and publish idle state. */
	private async clearState(): Promise<void> {
		this.operation = undefined
		await this.setSnapshot({ phase: "idle" })
	}

	/** Build a rejected result without mutating transaction state. */
	private reject(error: string, operationId?: string): ModeSwitchRequestResult {
		return { status: "rejected", operationId, error }
	}
}
