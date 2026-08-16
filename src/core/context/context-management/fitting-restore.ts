import { CompactionCheckpointConflictError, type CompactionCheckpointHead } from "./compaction-checkpoint-chain"
import type { CompactionRecoveryPhase, FittingRecoveryStore, LoadedCompactionCheckpointOperation } from "./fitting-recovery-store"

export interface CompactionRestoreContext {
	journalId: string
	sourceHead: CompactionCheckpointHead
	targetCheckpointId: string
	nextHead: CompactionCheckpointHead
	canonicalRestoreRequired: boolean
	completionPhase: Extract<CompactionRecoveryPhase, "prepared" | "pass_staged" | "cancelled" | "completed">
}

export interface PrepareCompactionCheckpointRestoreInput {
	store: FittingRecoveryStore
	operationId: string
	checkpointId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	completionPhase?: CompactionRestoreContext["completionPhase"]
}

export interface RestoreCompactionCheckpointInput<Payload> extends PrepareCompactionCheckpointRestoreInput {
	apply(payload: Payload, context: CompactionRestoreContext): Promise<void>
}

export interface RestoreRelativeCompactionCheckpointInput<Payload>
	extends Omit<RestoreCompactionCheckpointInput<Payload>, "checkpointId"> {}

export interface ResumeCompactionRestoreInput<Payload> {
	store: FittingRecoveryStore
	operationId: string
	apply(payload: Payload, context: CompactionRestoreContext): Promise<void>
}

export async function prepareCompactionCheckpointRestore<Payload>(
	input: PrepareCompactionCheckpointRestoreInput,
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	const operation = await input.store.loadOperation<Payload>(input.operationId)
	const target = await input.store.readCheckpoint<Payload>(input.checkpointId)
	const completionPhase = input.completionPhase ?? (target.artifact.kind === "root" ? "prepared" : "pass_staged")
	const canonicalRestoreRequired =
		operation.canonicalAppliedCheckpointId !== undefined &&
		(operation.canonicalAppliedCheckpointId !== input.checkpointId || completionPhase !== "completed")
	return input.store.beginRestore<Payload>({
		operationId: input.operationId,
		targetCheckpointId: input.checkpointId,
		expectedHeadCheckpointId: input.expectedHeadCheckpointId,
		expectedChainRevision: input.expectedChainRevision,
		canonicalRestoreRequired,
		completionPhase,
	})
}

export async function restoreCompactionCheckpoint<Payload>(
	input: RestoreCompactionCheckpointInput<Payload>,
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	const pending = await prepareCompactionCheckpointRestore<Payload>(input)
	return applyPendingRestore(pending, input.store, input.apply)
}

export async function restorePreviousCompactionCheckpoint<Payload>(
	input: RestoreRelativeCompactionCheckpointInput<Payload>,
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	const operation = await input.store.loadOperation<Payload>(input.operationId)
	assertExpectedHead(operation, input.expectedHeadCheckpointId, input.expectedChainRevision)
	const parentCheckpointId = operation.current.artifact.parentCheckpointId
	if (!parentCheckpointId) {
		return operation
	}
	return restoreCompactionCheckpoint({ ...input, checkpointId: parentCheckpointId })
}

export async function restoreInitialCompactionCheckpoint<Payload>(
	input: RestoreRelativeCompactionCheckpointInput<Payload>,
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	const operation = await input.store.loadOperation<Payload>(input.operationId)
	assertExpectedHead(operation, input.expectedHeadCheckpointId, input.expectedChainRevision)
	return restoreCompactionCheckpoint({ ...input, checkpointId: operation.root.checkpointId })
}

export async function resumePendingCompactionRestore<Payload>(
	input: ResumeCompactionRestoreInput<Payload>,
): Promise<LoadedCompactionCheckpointOperation<Payload> | undefined> {
	const operation = await input.store.loadOperation<Payload>(input.operationId)
	if (!operation.restoreJournal) return undefined
	return applyPendingRestore(operation, input.store, input.apply)
}

async function applyPendingRestore<Payload>(
	operation: LoadedCompactionCheckpointOperation<Payload>,
	store: FittingRecoveryStore,
	apply: RestoreCompactionCheckpointInput<Payload>["apply"],
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	const journal = operation.restoreJournal
	if (!journal) return operation
	const target = await store.readCheckpoint<Payload>(journal.targetCheckpointId)
	await apply(target.artifact.payload, {
		journalId: journal.journalId,
		sourceHead: journal.sourceHead,
		targetCheckpointId: journal.targetCheckpointId,
		nextHead: journal.targetHead,
		canonicalRestoreRequired: journal.canonicalRestoreRequired,
		completionPhase: journal.completionPhase,
	})
	return store.completeRestore<Payload>(operation.head.operationId, journal.journalId)
}

function assertExpectedHead(
	operation: LoadedCompactionCheckpointOperation,
	headCheckpointId: string,
	chainRevision: number,
): void {
	if (operation.head.headCheckpointId !== headCheckpointId || operation.head.chainRevision !== chainRevision) {
		throw new CompactionCheckpointConflictError("Compaction checkpoint head or revision is stale")
	}
}
