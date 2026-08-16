import type { CompactionCheckpointHead } from "./compaction-checkpoint-chain"
import type { FittingRecoveryStore, LoadedCompactionCheckpointOperation } from "./fitting-recovery-store"

export type CompactionCommitStatus = "completed" | "awaiting_adoption"

export interface CompactionCommitContext {
	journalId: string
	checkpointId: string
	checkpointHead: CompactionCheckpointHead
	requiresAdoption: boolean
}

export interface CommitCompactionCheckpointInput<Payload> {
	store: FittingRecoveryStore
	operationId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	requiresAdoption: boolean
	applyCanonical(payload: Payload, context: CompactionCommitContext): Promise<void>
}

export interface CompactionCommitResult<Payload> {
	status: CompactionCommitStatus
	journalId: string
	operation: LoadedCompactionCheckpointOperation<Payload>
}

export interface CompleteCompactionCommitInput {
	store: FittingRecoveryStore
	operationId: string
	journalId: string
}

export interface ResumeCompactionCommitInput<Payload> {
	store: FittingRecoveryStore
	operationId: string
	applyCanonical(payload: Payload, context: CompactionCommitContext): Promise<void>
}

export async function commitCompactionCheckpoint<Payload>(
	input: CommitCompactionCheckpointInput<Payload>,
): Promise<CompactionCommitResult<Payload>> {
	const operation = await input.store.beginCommit<Payload>({
		operationId: input.operationId,
		expectedHeadCheckpointId: input.expectedHeadCheckpointId,
		expectedChainRevision: input.expectedChainRevision,
		requiresAdoption: input.requiresAdoption,
	})
	if (!operation.commitJournal) {
		return {
			status: "completed",
			journalId: operation.lastCompletedCommitJournalId ?? "completed",
			operation,
		}
	}
	return applyPendingCommit(operation, input.store, input.applyCanonical)
}

export async function completeCompactionCommit<Payload>(
	input: CompleteCompactionCommitInput,
): Promise<LoadedCompactionCheckpointOperation<Payload>> {
	return input.store.completeCommit<Payload>(input.operationId, input.journalId)
}

export async function resumePendingCompactionCommit<Payload>(
	input: ResumeCompactionCommitInput<Payload>,
): Promise<CompactionCommitResult<Payload> | undefined> {
	const operation = await input.store.loadOperation<Payload>(input.operationId)
	if (!operation.commitJournal) return undefined
	if (isAdoptionPending(operation)) {
		return { status: "awaiting_adoption", journalId: operation.commitJournal.journalId, operation }
	}
	return applyPendingCommit(operation, input.store, input.applyCanonical)
}

async function applyPendingCommit<Payload>(
	operation: LoadedCompactionCheckpointOperation<Payload>,
	store: FittingRecoveryStore,
	applyCanonical: CommitCompactionCheckpointInput<Payload>["applyCanonical"],
): Promise<CompactionCommitResult<Payload>> {
	const journal = operation.commitJournal
	if (!journal) {
		return {
			status: "completed",
			journalId: operation.lastCompletedCommitJournalId ?? "completed",
			operation,
		}
	}
	const checkpoint = await store.readCheckpoint<Payload>(journal.checkpointId)
	if (operation.canonicalAppliedCheckpointId !== journal.checkpointId) {
		await applyCanonical(checkpoint.artifact.payload, {
			journalId: journal.journalId,
			checkpointId: journal.checkpointId,
			checkpointHead: operation.head,
			requiresAdoption: journal.requiresAdoption,
		})
	}
	const next = await store.markCommitCanonicalApplied<Payload>(operation.head.operationId, journal.journalId)
	return {
		status: journal.requiresAdoption ? "awaiting_adoption" : "completed",
		journalId: journal.journalId,
		operation: next,
	}
}

function isAdoptionPending(operation: LoadedCompactionCheckpointOperation): boolean {
	return (
		operation.commitJournal?.requiresAdoption === true &&
		operation.canonicalAppliedCheckpointId === operation.commitJournal.checkpointId
	)
}
