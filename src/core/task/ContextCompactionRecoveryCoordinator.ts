import {
	CompactionCheckpointConflictError,
	type CompactionCheckpointHead,
} from "@core/context/context-management/compaction-checkpoint-chain"
import { completeCompactionCommit, resumePendingCompactionCommit } from "@core/context/context-management/fitting-commit"
import type {
	CompactionRecoveryPhase,
	FittingRecoveryStore,
	LoadedCompactionCheckpointOperation,
} from "@core/context/context-management/fitting-recovery-store"
import {
	prepareCompactionCheckpointRestore,
	resumePendingCompactionRestore,
} from "@core/context/context-management/fitting-restore"
import type { TargetWindowFittingState } from "@core/context/context-management/target-window-fitting"
import type { ContextCompactionCheckpointPayload } from "./ContextCompactionCheckpoint"
import type { ContextCompactionRecoveryAdapter } from "./ContextCompactionRecoveryAdapter"
import type { ContextCompactionSession } from "./ContextCompactionSession"

export type ContextCompactionRestoreTarget =
	| { kind: "checkpoint"; checkpointId: string }
	| { kind: "previous" }
	| { kind: "initial" }

export interface ContextCompactionRestoreRequest {
	operationId: string
	target: ContextCompactionRestoreTarget
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	completionPhase?: Extract<CompactionRecoveryPhase, "prepared" | "pass_staged" | "cancelled" | "completed">
}

export interface ContextCompactionRestoreResult {
	operationId: string
	checkpointId: string
	head: CompactionCheckpointHead
	phase: CompactionRecoveryPhase
	fittingState: TargetWindowFittingState
}

export interface ContextCompactionRecoveryCoordinatorPorts {
	store(): Promise<FittingRecoveryStore>
	adapter(): ContextCompactionRecoveryAdapter
	session(): ContextCompactionSession
	onRestorePrepared?(operationId: string): void
	onRecoveryFailure?(operationId: string, error: unknown): void
}

/** Coordinate Task-local restore/commit recovery without exposing payload persistence to callers. */
export class ContextCompactionRecoveryCoordinator {
	constructor(private readonly ports: ContextCompactionRecoveryCoordinatorPorts) {}

	async restore(request: ContextCompactionRestoreRequest): Promise<ContextCompactionRestoreResult> {
		return this.restoreInternal(request, true)
	}

	async restoreAfterFailure(request: ContextCompactionRestoreRequest): Promise<ContextCompactionRestoreResult> {
		return this.restoreInternal(request, false)
	}

	private async restoreInternal(
		request: ContextCompactionRestoreRequest,
		interruptActiveSession: boolean,
	): Promise<ContextCompactionRestoreResult> {
		const store = await this.ports.store()
		const operation = await store.loadOperation<ContextCompactionCheckpointPayload>(request.operationId)
		if (
			operation.head.headCheckpointId !== request.expectedHeadCheckpointId ||
			operation.head.chainRevision !== request.expectedChainRevision
		) {
			throw new CompactionCheckpointConflictError("Compaction checkpoint head or revision is stale")
		}
		const checkpointId = resolveRestoreCheckpointId(operation, request.target)
		if (!checkpointId) return toRestoreResult(operation)

		const activeOperationId = this.ports.session().getActiveOperationId()
		if (activeOperationId && activeOperationId !== request.operationId) {
			throw new Error("Another context compaction operation is active.")
		}
		const activeCompletionPhase =
			request.completionPhase === undefined && activeOperationId === request.operationId
				? (await store.readCheckpoint<ContextCompactionCheckpointPayload>(checkpointId)).artifact.kind === "root"
					? "prepared"
					: "pass_staged"
				: request.completionPhase

		let pending: LoadedCompactionCheckpointOperation<ContextCompactionCheckpointPayload> | undefined
		const prepare = async (): Promise<void> => {
			pending = await prepareCompactionCheckpointRestore<ContextCompactionCheckpointPayload>({
				store,
				operationId: request.operationId,
				checkpointId,
				expectedHeadCheckpointId: request.expectedHeadCheckpointId,
				expectedChainRevision: request.expectedChainRevision,
				completionPhase: activeCompletionPhase,
			})
			this.ports.onRestorePrepared?.(request.operationId)
		}
		const apply = async () => {
			const restored = await resumePendingCompactionRestore<ContextCompactionCheckpointPayload>({
				store,
				operationId: request.operationId,
				apply: (payload, context) => this.ports.adapter().applyRestore(payload, context),
			})
			const completed = restored ?? pending
			if (!completed) throw new Error("Prepared context compaction restore journal is unavailable.")
			return {
				state: completed.current.artifact.payload.fittingState,
				checkpointHead: completed.head,
			}
		}

		if (interruptActiveSession && activeOperationId === request.operationId) {
			await this.ports.session().restore(request.operationId, { prepare, apply })
		} else {
			await prepare()
			await apply()
		}
		return toRestoreResult(await store.loadOperation<ContextCompactionCheckpointPayload>(request.operationId))
	}

	async completeAdoption(operationId: string): Promise<void> {
		const store = await this.ports.store()
		const operation = await store.loadOperationIfPresent<ContextCompactionCheckpointPayload>(operationId)
		if (!operation || operation.phase === "cancelled") return
		if (operation.phase === "completed" && operation.committedCheckpointId === operation.head.headCheckpointId) return
		if (
			operation.commitJournal?.requiresAdoption !== true ||
			operation.canonicalAppliedCheckpointId !== operation.commitJournal.checkpointId
		) {
			throw new Error("Context compaction adoption journal is not ready for barrier release.")
		}
		await completeCompactionCommit<ContextCompactionCheckpointPayload>({
			store,
			operationId,
			journalId: operation.commitJournal.journalId,
		})
	}

	async resumePendingJournals(): Promise<void> {
		const store = await this.ports.store()
		const pending = (await store.listOperations<ContextCompactionCheckpointPayload>()).filter(
			(operation) => operation.restoreJournal || operation.commitJournal,
		)
		if (pending.length > 1) {
			throw new Error("Multiple unfinished context compaction journals require manual recovery.")
		}
		const operation = pending[0]
		if (!operation) return

		if (operation.restoreJournal) {
			await resumePendingCompactionRestore<ContextCompactionCheckpointPayload>({
				store,
				operationId: operation.head.operationId,
				apply: (payload, context) => this.ports.adapter().applyRestore(payload, context),
			})
		}

		const afterRestore = await store.loadOperation<ContextCompactionCheckpointPayload>(operation.head.operationId)
		if (!afterRestore.commitJournal) return
		const resumed = await resumePendingCompactionCommit<ContextCompactionCheckpointPayload>({
			store,
			operationId: afterRestore.head.operationId,
			applyCanonical: (payload, context) => this.ports.adapter().applyCanonical(payload, context),
		})
		if (resumed?.status !== "awaiting_adoption") return
		try {
			await this.ports.adapter().applyTransition(resumed.operation.current.artifact.payload, "target")
			await completeCompactionCommit<ContextCompactionCheckpointPayload>({
				store,
				operationId: resumed.operation.head.operationId,
				journalId: resumed.journalId,
			})
		} catch (error) {
			const failed = await store.loadOperation<ContextCompactionCheckpointPayload>(resumed.operation.head.operationId)
			await this.restoreInternal(
				{
					operationId: failed.head.operationId,
					target: { kind: "initial" },
					expectedHeadCheckpointId: failed.head.headCheckpointId,
					expectedChainRevision: failed.head.chainRevision,
					completionPhase: "cancelled",
				},
				false,
			)
			this.ports.onRecoveryFailure?.(failed.head.operationId, error)
		}
	}
}

function resolveRestoreCheckpointId(
	operation: LoadedCompactionCheckpointOperation<ContextCompactionCheckpointPayload>,
	target: ContextCompactionRestoreTarget,
): string | undefined {
	switch (target.kind) {
		case "checkpoint":
			return target.checkpointId
		case "previous":
			return operation.current.artifact.parentCheckpointId
		case "initial":
			return operation.root.checkpointId
	}
}

function toRestoreResult(
	operation: LoadedCompactionCheckpointOperation<ContextCompactionCheckpointPayload>,
): ContextCompactionRestoreResult {
	return {
		operationId: operation.head.operationId,
		checkpointId: operation.current.checkpointId,
		head: operation.head,
		phase: operation.phase,
		fittingState: operation.current.artifact.payload.fittingState,
	}
}
