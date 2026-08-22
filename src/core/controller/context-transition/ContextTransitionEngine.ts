import type { ApiHandler } from "@core/api"
import type { TaskCompactionPort } from "@core/controller/context-transition/types"
import type { ContextCompactionTransitionState } from "@core/task/ContextCompactionSession"
import type { ChatContent } from "@shared/ChatContent"
import type { Mode } from "@shared/storage/types"
import type { ContextTransitionKind, ContextTransitionLease } from "./ContextTransitionLease"

export type ContextTransitionPhase = "idle" | "preflighting" | "awaiting_confirmation" | "compacting" | "committing" | "failed"
export type ContextTransitionRequestStatus = "switched" | "confirmation_required" | "in_progress" | "rejected"
export type ContextTransitionCompactionResult = "completed" | "cancelled" | "failed"
export type ContextTransitionConfirmationOrder = "compact_then_commit" | "commit_then_compact"

export interface ContextTransitionSnapshotContext {
	targetAdopted: boolean
}

export interface ContextTransitionRequest {
	taskId: string
}

export interface ContextTransitionOperation {
	operationId: string
	taskId: string
}

export interface ContextTransitionSnapshot {
	phase: ContextTransitionPhase
	operationId?: string
	taskId?: string
	error?: string
}

export interface ContextTransitionRequestResult {
	status: ContextTransitionRequestStatus
	operationId?: string
	error?: string
}

export interface ContextTransitionCompactionRequest {
	operationId: string
	targetApi: ApiHandler
	targetMode: Mode
	chatContent?: ChatContent
	transition: ContextCompactionTransitionState
}

export type ContextTransitionPreparation<Operation extends ContextTransitionOperation> =
	| { kind: "rejected"; error: string }
	| { kind: "direct"; operation: Operation }
	| { kind: "confirm"; operation: Operation }

export interface ContextTransitionPolicy<
	Request extends ContextTransitionRequest,
	Operation extends ContextTransitionOperation,
	Snapshot extends ContextTransitionSnapshot,
> {
	readonly kind: ContextTransitionKind
	readonly confirmationOrder: ContextTransitionConfirmationOrder
	prepareWithoutLease?(request: Request, operationId: string): Operation | undefined
	prepare(request: Request, operationId: string): Promise<ContextTransitionPreparation<Operation>>
	validate(operation: Operation): boolean
	createCompactionRequest(operation: Operation): ContextTransitionCompactionRequest
	commit(operation: Operation): Promise<void>
	createSnapshot(
		operation: Operation,
		phase: ContextTransitionPhase,
		error?: string,
		context?: ContextTransitionSnapshotContext,
	): Snapshot
	cancelledError(): string
	compactionError(result: Exclude<ContextTransitionCompactionResult, "completed">): string
	staleConfirmationError(): string
	staleCancellationError(): string
	stateChangedError(): string
}

interface ActiveTransition {
	kind: ContextTransitionKind
	operationId: string
	taskId: string
	phase: Exclude<ContextTransitionPhase, "idle" | "failed">
	operation?: ContextTransitionOperation
	policy: ContextTransitionPolicy<ContextTransitionRequest, ContextTransitionOperation, ContextTransitionSnapshot>
	compactionStarted: boolean
	targetAdopted: boolean
}

export interface ContextTransitionEngineDeps {
	lease: ContextTransitionLease
	compaction: TaskCompactionPort
	postState: () => Promise<void>
	createId: () => string
}

/** Own the only Profile/Mode transition operation and phase state. */
export class ContextTransitionEngine {
	private active: ActiveTransition | undefined
	private directCommit: { operationId: string; taskId: string } | undefined
	private readonly snapshots: Record<ContextTransitionKind, ContextTransitionSnapshot> = {
		mode: { phase: "idle" },
		profile: { phase: "idle" },
	}

	constructor(private readonly deps: ContextTransitionEngineDeps) {}

	async request<
		Request extends ContextTransitionRequest,
		Operation extends ContextTransitionOperation,
		Snapshot extends ContextTransitionSnapshot,
	>(policy: ContextTransitionPolicy<Request, Operation, Snapshot>, request: Request): Promise<ContextTransitionRequestResult> {
		if (this.snapshots[policy.kind].phase === "failed") {
			await this.publish(policy.kind, { phase: "idle" })
		}
		if (this.active) {
			return { status: "in_progress", operationId: this.active.operationId }
		}
		if (this.directCommit) {
			return { status: "in_progress", operationId: this.directCommit.operationId }
		}
		const leaseOwner = this.deps.lease.getActive()
		if (leaseOwner) {
			return { status: "in_progress", operationId: leaseOwner.operationId }
		}

		const operationId = this.deps.createId()
		if (policy.prepareWithoutLease) {
			try {
				const directOperation = policy.prepareWithoutLease(request, operationId)
				if (directOperation) {
					if (!policy.validate(directOperation)) {
						return { status: "rejected", operationId, error: policy.stateChangedError() }
					}
					this.directCommit = { operationId, taskId: request.taskId }
					try {
						await policy.commit(directOperation)
						return { status: "switched", operationId }
					} finally {
						if (this.directCommit?.operationId === operationId) this.directCommit = undefined
					}
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Context transition direct commit failed."
				return { status: "rejected", operationId, error: reason }
			}
		}
		if (!this.deps.lease.acquire({ kind: policy.kind, operationId, taskId: request.taskId })) {
			return { status: "in_progress", operationId: this.deps.lease.getActive()?.operationId }
		}
		const erasedPolicy = policy as unknown as ContextTransitionPolicy<
			ContextTransitionRequest,
			ContextTransitionOperation,
			ContextTransitionSnapshot
		>
		this.active = {
			kind: policy.kind,
			operationId,
			taskId: request.taskId,
			phase: "preflighting",
			policy: erasedPolicy,
			compactionStarted: false,
			targetAdopted: false,
		}
		await this.publish(policy.kind, {
			phase: "preflighting",
			operationId,
			taskId: request.taskId,
		})

		let preparation: ContextTransitionPreparation<Operation>
		try {
			preparation = await policy.prepare(request, operationId)
		} catch (error) {
			return this.failPreparation(policy.kind, operationId, error)
		}
		if (!this.isActive(operationId, policy.kind)) {
			return { status: "rejected", operationId, error: "Context transition became stale during preflight." }
		}
		if (preparation.kind === "rejected") {
			await this.clearActive(operationId)
			return { status: "rejected", operationId, error: preparation.error }
		}

		this.active.operation = preparation.operation
		if (preparation.kind === "confirm") {
			this.active.phase = "awaiting_confirmation"
			await this.publish(
				policy.kind,
				policy.createSnapshot(preparation.operation, "awaiting_confirmation", undefined, {
					targetAdopted: this.active.targetAdopted,
				}),
			)
			return { status: "confirmation_required", operationId }
		}
		return this.commitActive(policy, preparation.operation, false)
	}

	async confirm(operationId: string): Promise<ContextTransitionRequestResult> {
		const active = this.active
		if (!active || active.operationId !== operationId || active.phase !== "awaiting_confirmation" || !active.operation) {
			const policy = active?.policy
			return {
				status: "rejected",
				operationId,
				error: policy?.staleConfirmationError() ?? "Context transition confirmation is stale.",
			}
		}
		if (!this.deps.lease.owns(operationId) || !active.policy.validate(active.operation)) {
			return this.failActive(active.policy.stateChangedError(), false)
		}

		try {
			if (active.policy.confirmationOrder === "commit_then_compact") {
				active.phase = "committing"
				await this.publish(
					active.kind,
					active.policy.createSnapshot(active.operation, "committing", undefined, {
						targetAdopted: active.targetAdopted,
					}),
				)
				await active.policy.commit(active.operation)
				active.targetAdopted = true
			}

			active.phase = "compacting"
			active.compactionStarted = true
			await this.publish(
				active.kind,
				active.policy.createSnapshot(active.operation, "compacting", undefined, {
					targetAdopted: active.targetAdopted,
				}),
			)
			const compaction = active.policy.createCompactionRequest(active.operation)
			const compactResult = await this.deps.compaction.compact({
				trigger: active.kind === "profile" ? "profile_switch" : "mode_switch",
				...compaction,
			})
			if (compactResult !== "completed") {
				return this.failActive(active.policy.compactionError(compactResult), true)
			}
			if (active.policy.confirmationOrder === "commit_then_compact") {
				await this.deps.compaction.release(active.operationId)
				await this.clearActive(active.operationId)
				return { status: "switched", operationId: active.operationId }
			}
			return this.commitActive(active.policy, active.operation, true)
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Context transition compaction failed."
			return this.failActive(reason, active.compactionStarted)
		}
	}

	async cancel(operationId: string): Promise<ContextTransitionRequestResult> {
		const active = this.active
		if (!active || active.operationId !== operationId || active.phase !== "awaiting_confirmation") {
			return {
				status: "rejected",
				operationId,
				error: active?.policy.staleCancellationError() ?? "Context transition cancellation is stale.",
			}
		}
		const error = active.policy.cancelledError()
		await this.clearActive(operationId)
		return { status: "rejected", operationId, error }
	}

	getSnapshot<Snapshot extends ContextTransitionSnapshot>(kind: ContextTransitionKind): Snapshot {
		return { ...this.snapshots[kind] } as Snapshot
	}

	async reset(reason = "Context transition reset."): Promise<void> {
		const active = this.active
		if (active?.operation) {
			await this.cleanupCompaction(active.operationId, reason)
		}
		if (active) {
			await this.clearActive(active.operationId)
			return
		}
		await Promise.all([this.publish("mode", { phase: "idle" }), this.publish("profile", { phase: "idle" })])
	}

	private async commitActive<Operation extends ContextTransitionOperation, Snapshot extends ContextTransitionSnapshot>(
		policy: ContextTransitionPolicy<ContextTransitionRequest, Operation, Snapshot>,
		operation: Operation,
		releaseBarrier: boolean,
	): Promise<ContextTransitionRequestResult> {
		if (!this.isActive(operation.operationId, policy.kind) || !policy.validate(operation)) {
			return this.failActive(policy.stateChangedError(), releaseBarrier)
		}
		if (!this.active) {
			return { status: "rejected", operationId: operation.operationId, error: policy.stateChangedError() }
		}
		this.active.phase = "committing"
		await this.publish(policy.kind, policy.createSnapshot(operation, "committing"))
		try {
			await policy.commit(operation)
			if (releaseBarrier) await this.deps.compaction.release(operation.operationId)
			await this.clearActive(operation.operationId)
			return { status: "switched", operationId: operation.operationId }
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Context transition commit failed."
			return this.failActive(reason, releaseBarrier)
		}
	}

	private async failPreparation(
		kind: ContextTransitionKind,
		operationId: string,
		error: unknown,
	): Promise<ContextTransitionRequestResult> {
		const reason = error instanceof Error ? error.message : "Context transition preflight failed."
		if (this.isActive(operationId, kind)) {
			await this.clearActive(operationId)
		}
		return { status: "rejected", operationId, error: reason }
	}

	private async failActive(reason: string, releaseBarrier: boolean): Promise<ContextTransitionRequestResult> {
		const active = this.active
		if (!active?.operation) {
			return { status: "rejected", error: reason }
		}
		let reportedReason = reason
		try {
			if (releaseBarrier || active.compactionStarted) {
				const cleanupError = await this.cleanupCompaction(active.operationId, reason)
				if (cleanupError) reportedReason = `${reason} ${cleanupError}`
			}
		} finally {
			this.deps.lease.release(active.operationId)
			if (this.active === active) this.active = undefined
		}
		try {
			await this.publish(
				active.kind,
				active.policy.createSnapshot(active.operation, "failed", reportedReason, {
					targetAdopted: active.targetAdopted,
				}),
			)
		} catch {
			// The transaction is already released; a later state publication can recover the view.
		}
		return { status: "rejected", operationId: active.operationId, error: reportedReason }
	}

	/** Best-effort rollback and barrier release without allowing cleanup errors to retain the shared lease. */
	private async cleanupCompaction(operationId: string, reason: string): Promise<string | undefined> {
		const failures: string[] = []
		try {
			await this.deps.compaction.fail(operationId, reason)
		} catch (error) {
			failures.push(`Rollback failed: ${error instanceof Error ? error.message : String(error)}.`)
		}
		try {
			await this.deps.compaction.release(operationId)
		} catch (error) {
			failures.push(`Barrier release failed: ${error instanceof Error ? error.message : String(error)}.`)
		}
		return failures.length ? failures.join(" ") : undefined
	}

	private isActive(operationId: string, kind: ContextTransitionKind): boolean {
		return this.active?.operationId === operationId && this.active.kind === kind && this.deps.lease.owns(operationId)
	}

	private async clearActive(operationId: string): Promise<void> {
		const active = this.active
		if (!active || active.operationId !== operationId) return
		this.active = undefined
		this.deps.lease.release(operationId)
		await this.publish(active.kind, { phase: "idle" })
	}

	private async publish(kind: ContextTransitionKind, snapshot: ContextTransitionSnapshot): Promise<void> {
		this.snapshots[kind] = { ...snapshot }
		await this.deps.postState()
	}
}
