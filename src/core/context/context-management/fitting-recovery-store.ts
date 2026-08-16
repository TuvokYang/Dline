import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { FileLock } from "@core/storage/FileLock"
import {
	COMPACTION_CHECKPOINT_SCHEMA_VERSION,
	CompactionCheckpointConflictError,
	type CompactionCheckpointHead,
	CompactionCheckpointIntegrityError,
	compareAndSwapCompactionCheckpointHead,
	createChildCompactionCheckpoint,
	createRootCompactionCheckpoint,
	createRootCompactionCheckpointHead,
	hashCompactionCheckpointValue,
	type StoredCompactionCheckpoint,
	serializeCompactionCheckpointValue,
	verifyStoredCompactionCheckpoint,
} from "./compaction-checkpoint-chain"
import type { InternalCompactionAttemptIdentity } from "./internal-compaction-pass"
import type { CompactionPassIdentity } from "./target-window-fitting"

export type CompactionRecoveryPhase =
	| "prepared"
	| "pass_staged"
	| "restore_pending"
	| "commit_pending"
	| "completed"
	| "cancelled"

export interface CompactionRestoreJournal {
	schemaVersion: 1
	journalId: string
	operationId: string
	sourceHead: CompactionCheckpointHead
	targetCheckpointId: string
	targetHead: CompactionCheckpointHead
	canonicalRestoreRequired: boolean
	completionPhase: "prepared" | "pass_staged" | "cancelled" | "completed"
}

export interface CompactionCommitJournal {
	schemaVersion: 1
	journalId: string
	operationId: string
	checkpointId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	requiresAdoption: boolean
}

interface CompactionRecoveryRecord extends CompactionCheckpointHead {
	phase: CompactionRecoveryPhase
	detachedBranchIds: string[]
	restoreJournal?: CompactionRestoreJournal
	commitJournal?: CompactionCommitJournal
	canonicalAppliedCheckpointId?: string
	committedCheckpointId?: string
	lastCompletedRestoreJournalId?: string
	lastCompletedCommitJournalId?: string
}

export interface LoadedCompactionCheckpointOperation<Payload = unknown> {
	head: CompactionCheckpointHead
	root: StoredCompactionCheckpoint<Payload>
	current: StoredCompactionCheckpoint<Payload>
	phase: CompactionRecoveryPhase
	detachedBranchIds: string[]
	restoreJournal?: CompactionRestoreJournal
	commitJournal?: CompactionCommitJournal
	canonicalAppliedCheckpointId?: string
	committedCheckpointId?: string
	lastCompletedRestoreJournalId?: string
	lastCompletedCommitJournalId?: string
}

export interface CreateCompactionCheckpointRootInput<Payload> {
	operationId: string
	branchId: string
	payload: Payload
}

export interface AppendCompactionCheckpointInput<Payload> {
	operationId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	passIdentity: CompactionPassIdentity
	attempt: InternalCompactionAttemptIdentity
	payload: Payload
}

export interface BeginCompactionRestoreInput {
	operationId: string
	targetCheckpointId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	canonicalRestoreRequired: boolean
	completionPhase?: CompactionRestoreJournal["completionPhase"]
}

export interface BeginCompactionCommitInput {
	operationId: string
	expectedHeadCheckpointId: string
	expectedChainRevision: number
	requiresAdoption: boolean
}

const RENAME_RETRY_DELAYS_MS = [10, 25, 50] as const
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

function integrityError(message: string): CompactionCheckpointIntegrityError {
	return new CompactionCheckpointIntegrityError(`Compaction checkpoint integrity error: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function operationHeadPath(directoryPath: string, operationId: string): string {
	const digest = hashCompactionCheckpointValue(operationId).replace(/^sha256:/, "")
	return path.join(directoryPath, "operations", `${digest}.head.json`)
}

async function renameWithRetry(sourcePath: string, destinationPath: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
				throw error
			}
			await new Promise<void>((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
		}
	}
}

async function writeAtomicFile(filePath: string, content: string): Promise<void> {
	const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`
	let handle: Awaited<ReturnType<typeof fs.open>> | undefined
	try {
		handle = await fs.open(tempPath, "wx")
		await handle.writeFile(content, "utf8")
		await handle.sync()
		await handle.close()
		handle = undefined
		await renameWithRetry(tempPath, filePath)
	} catch (error) {
		await handle?.close().catch(() => undefined)
		await fs.rm(tempPath, { force: true }).catch(() => undefined)
		throw error
	}
}

function parseCheckpointHead(raw: string, operationId: string): CompactionRecoveryRecord {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch (error) {
		throw integrityError(`operation head is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (
		!isRecord(value) ||
		value.schemaVersion !== COMPACTION_CHECKPOINT_SCHEMA_VERSION ||
		value.operationId !== operationId ||
		typeof value.rootCheckpointId !== "string" ||
		typeof value.headCheckpointId !== "string" ||
		typeof value.branchId !== "string" ||
		!Number.isSafeInteger(value.chainRevision) ||
		!Number.isSafeInteger(value.sequence) ||
		!Number.isSafeInteger(value.depth)
	) {
		throw integrityError("operation head has an invalid schema or identity")
	}
	const head = value as unknown as CompactionCheckpointHead
	if (head.chainRevision < 0 || head.sequence < 0 || head.depth < 0 || !head.branchId.trim()) {
		throw integrityError("operation head has invalid counters or branch identity")
	}
	if (!/^sha256:[a-f0-9]{64}$/.test(head.rootCheckpointId) || !/^sha256:[a-f0-9]{64}$/.test(head.headCheckpointId)) {
		throw integrityError("operation head contains an invalid checkpoint identity")
	}
	const persistedPhase = typeof value.phase === "string" ? value.phase : head.depth === 0 ? "prepared" : "pass_staged"
	const phase = persistedPhase === "awaiting_adoption" ? "commit_pending" : persistedPhase
	if (!isCompactionRecoveryPhase(phase)) throw integrityError("operation head contains an invalid recovery phase")
	const detachedBranchIds = Array.isArray(value.detachedBranchIds)
		? value.detachedBranchIds.filter(
				(branchId): branchId is string => typeof branchId === "string" && Boolean(branchId.trim()),
			)
		: []
	return {
		...head,
		phase,
		detachedBranchIds,
		restoreJournal: parseRestoreJournal(value.restoreJournal, operationId),
		commitJournal: parseCommitJournal(value.commitJournal, operationId),
		canonicalAppliedCheckpointId: parseOptionalCheckpointId(value.canonicalAppliedCheckpointId),
		committedCheckpointId: parseOptionalCheckpointId(value.committedCheckpointId),
		lastCompletedRestoreJournalId: parseOptionalNonEmptyString(value.lastCompletedRestoreJournalId),
		lastCompletedCommitJournalId: parseOptionalNonEmptyString(value.lastCompletedCommitJournalId),
	}
}

function isCompactionRecoveryPhase(value: string): value is CompactionRecoveryPhase {
	return ["prepared", "pass_staged", "restore_pending", "commit_pending", "completed", "cancelled"].includes(value)
}

function parseOptionalCheckpointId(value: unknown): string | undefined {
	if (value === undefined) return undefined
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
		throw integrityError("operation record contains an invalid optional checkpoint identity")
	}
	return value
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
	if (value === undefined) return undefined
	if (typeof value !== "string" || !value.trim()) {
		throw integrityError("operation record contains an invalid journal identity")
	}
	return value
}

function parseRestoreJournal(value: unknown, operationId: string): CompactionRestoreJournal | undefined {
	if (value === undefined) return undefined
	if (!isRecord(value) || value.schemaVersion !== 1 || value.operationId !== operationId) {
		throw integrityError("restore journal has an invalid schema or operation identity")
	}
	if (
		typeof value.journalId !== "string" ||
		typeof value.targetCheckpointId !== "string" ||
		typeof value.canonicalRestoreRequired !== "boolean" ||
		typeof value.completionPhase !== "string" ||
		!isRecord(value.sourceHead) ||
		!isRecord(value.targetHead)
	) {
		throw integrityError("restore journal is incomplete")
	}
	return value as unknown as CompactionRestoreJournal
}

function parseCommitJournal(value: unknown, operationId: string): CompactionCommitJournal | undefined {
	if (value === undefined) return undefined
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		value.operationId !== operationId ||
		typeof value.journalId !== "string" ||
		typeof value.checkpointId !== "string" ||
		typeof value.expectedHeadCheckpointId !== "string" ||
		!Number.isSafeInteger(value.expectedChainRevision) ||
		typeof value.requiresAdoption !== "boolean"
	) {
		throw integrityError("commit journal has an invalid schema or identity")
	}
	return value as unknown as CompactionCommitJournal
}

export class FittingRecoveryStore {
	private readonly fileLock = new FileLock()

	constructor(private readonly directoryPath: string) {}

	async createRoot<Payload>(
		input: CreateCompactionCheckpointRootInput<Payload>,
	): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		const root = createRootCompactionCheckpoint(input)
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, input.operationId)
		return this.fileLock.withLock(headPath, async () => {
			const existingHead = await this.readHeadIfPresent(input.operationId)
			if (existingHead) {
				const existing = await this.loadFromHead<Payload>(existingHead)
				if (existing.root.checkpointId !== root.checkpointId) {
					throw new CompactionCheckpointConflictError("Compaction operation already has a different C0")
				}
				return existing
			}
			await this.writeImmutableCheckpoint(root)
			const head: CompactionRecoveryRecord = {
				...createRootCompactionCheckpointHead(root),
				phase: "prepared",
				detachedBranchIds: [],
			}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(head))
			return this.loadFromHead<Payload>(await this.readHead(input.operationId))
		})
	}

	async appendCheckpoint<Payload>(
		input: AppendCompactionCheckpointInput<Payload>,
	): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, input.operationId)
		return this.fileLock.withLock(headPath, async () => {
			const head = await this.readHead(input.operationId)
			if (head.restoreJournal || head.commitJournal || (head.phase !== "prepared" && head.phase !== "pass_staged")) {
				throw new CompactionCheckpointConflictError("Compaction operation is not accepting another Pass checkpoint")
			}
			if (head.headCheckpointId !== input.expectedHeadCheckpointId || head.chainRevision !== input.expectedChainRevision) {
				throw new CompactionCheckpointConflictError("Compaction checkpoint head or revision is stale")
			}
			const parent = await this.readCheckpoint(head.headCheckpointId)
			const child = createChildCompactionCheckpoint({
				head,
				parent,
				passIdentity: input.passIdentity,
				attempt: input.attempt,
				payload: input.payload,
			})
			await this.writeImmutableCheckpoint(child)
			const nextHead = compareAndSwapCompactionCheckpointHead(
				head,
				{
					headCheckpointId: input.expectedHeadCheckpointId,
					chainRevision: input.expectedChainRevision,
				},
				child,
			)
			const nextRecord: CompactionRecoveryRecord = {
				...head,
				...nextHead,
				phase: "pass_staged",
				restoreJournal: undefined,
				commitJournal: undefined,
				committedCheckpointId: undefined,
			}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(nextRecord))
			return this.loadFromHead<Payload>(await this.readHead(input.operationId))
		})
	}

	async beginRestore<Payload>(input: BeginCompactionRestoreInput): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, input.operationId)
		return this.fileLock.withLock(headPath, async () => {
			const record = await this.readHead(input.operationId)
			if (record.restoreJournal) {
				const journal = record.restoreJournal
				if (
					journal.sourceHead.headCheckpointId === input.expectedHeadCheckpointId &&
					journal.sourceHead.chainRevision === input.expectedChainRevision &&
					journal.targetCheckpointId === input.targetCheckpointId &&
					journal.canonicalRestoreRequired === input.canonicalRestoreRequired &&
					(input.completionPhase === undefined || journal.completionPhase === input.completionPhase)
				) {
					return this.loadFromHead<Payload>(record)
				}
				throw new CompactionCheckpointConflictError("Another compaction restore journal is already pending")
			}
			const adoptionPending =
				record.commitJournal?.requiresAdoption === true &&
				record.canonicalAppliedCheckpointId === record.commitJournal.checkpointId
			if (record.commitJournal && !adoptionPending) {
				throw new CompactionCheckpointConflictError("Compaction commit must finish before restoring a checkpoint")
			}
			this.assertExpectedHead(record, input.expectedHeadCheckpointId, input.expectedChainRevision)
			const target = await this.readCheckpoint<Payload>(input.targetCheckpointId)
			this.assertCheckpointBelongsToOperation(target, record)
			const targetHead: CompactionCheckpointHead = {
				schemaVersion: COMPACTION_CHECKPOINT_SCHEMA_VERSION,
				operationId: record.operationId,
				rootCheckpointId: record.rootCheckpointId,
				headCheckpointId: target.checkpointId,
				branchId: `branch:${record.operationId}:${record.chainRevision + 1}`,
				chainRevision: record.chainRevision + 1,
				sequence: record.sequence + 1,
				depth: target.artifact.depth,
			}
			const completionPhase = input.completionPhase ?? (target.artifact.kind === "root" ? "prepared" : "pass_staged")
			const restoreJournal: CompactionRestoreJournal = {
				schemaVersion: 1,
				journalId: `restore:${record.operationId}:${targetHead.chainRevision}:${randomUUID()}`,
				operationId: record.operationId,
				sourceHead: selectCheckpointHead(record),
				targetCheckpointId: target.checkpointId,
				targetHead,
				canonicalRestoreRequired: input.canonicalRestoreRequired,
				completionPhase,
			}
			const pending: CompactionRecoveryRecord = {
				...record,
				phase: "restore_pending",
				restoreJournal,
				commitJournal: undefined,
				committedCheckpointId: undefined,
			}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(pending))
			return this.loadFromHead<Payload>(await this.readHead(input.operationId))
		})
	}

	async completeRestore<Payload>(
		operationId: string,
		journalId: string,
	): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, operationId)
		return this.fileLock.withLock(headPath, async () => {
			const record = await this.readHead(operationId)
			if (!record.restoreJournal) {
				if (record.lastCompletedRestoreJournalId === journalId) return this.loadFromHead<Payload>(record)
				throw new CompactionCheckpointConflictError("Compaction restore journal is unavailable or stale")
			}
			if (record.restoreJournal.journalId !== journalId) {
				throw new CompactionCheckpointConflictError("Compaction restore journal identity is stale")
			}
			const journal = record.restoreJournal
			const detachedBranchIds =
				journal.sourceHead.branchId === journal.targetHead.branchId
					? record.detachedBranchIds
					: [...new Set([...record.detachedBranchIds, journal.sourceHead.branchId])]
			const nextRecord: CompactionRecoveryRecord = {
				...record,
				...journal.targetHead,
				phase: journal.completionPhase,
				detachedBranchIds,
				restoreJournal: undefined,
				commitJournal: undefined,
				canonicalAppliedCheckpointId: journal.canonicalRestoreRequired
					? journal.completionPhase === "completed"
						? journal.targetCheckpointId
						: undefined
					: record.canonicalAppliedCheckpointId,
				committedCheckpointId: journal.completionPhase === "completed" ? journal.targetCheckpointId : undefined,
				lastCompletedRestoreJournalId: journal.journalId,
			}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(nextRecord))
			return this.loadFromHead<Payload>(await this.readHead(operationId))
		})
	}

	async beginCommit<Payload>(input: BeginCompactionCommitInput): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, input.operationId)
		return this.fileLock.withLock(headPath, async () => {
			const record = await this.readHead(input.operationId)
			if (record.restoreJournal) {
				throw new CompactionCheckpointConflictError("Compaction restore must finish before committing")
			}
			if (record.commitJournal) {
				const journal = record.commitJournal
				if (
					journal.expectedHeadCheckpointId === input.expectedHeadCheckpointId &&
					journal.expectedChainRevision === input.expectedChainRevision &&
					journal.requiresAdoption === input.requiresAdoption
				) {
					return this.loadFromHead<Payload>(record)
				}
				throw new CompactionCheckpointConflictError("Another compaction commit journal is already pending")
			}
			this.assertExpectedHead(record, input.expectedHeadCheckpointId, input.expectedChainRevision)
			if (record.phase === "completed" && record.committedCheckpointId === record.headCheckpointId) {
				return this.loadFromHead<Payload>(record)
			}
			const commitJournal: CompactionCommitJournal = {
				schemaVersion: 1,
				journalId: `commit:${record.operationId}:${record.chainRevision}:${randomUUID()}`,
				operationId: record.operationId,
				checkpointId: record.headCheckpointId,
				expectedHeadCheckpointId: input.expectedHeadCheckpointId,
				expectedChainRevision: input.expectedChainRevision,
				requiresAdoption: input.requiresAdoption,
			}
			const pending: CompactionRecoveryRecord = { ...record, phase: "commit_pending", commitJournal }
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(pending))
			return this.loadFromHead<Payload>(await this.readHead(input.operationId))
		})
	}

	async markCommitCanonicalApplied<Payload>(
		operationId: string,
		journalId: string,
	): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, operationId)
		return this.fileLock.withLock(headPath, async () => {
			const record = await this.readHead(operationId)
			if (!record.commitJournal) {
				if (record.lastCompletedCommitJournalId === journalId) return this.loadFromHead<Payload>(record)
				throw new CompactionCheckpointConflictError("Compaction commit journal is unavailable or stale")
			}
			if (record.commitJournal.journalId !== journalId) {
				throw new CompactionCheckpointConflictError("Compaction commit journal identity is stale")
			}
			const journal = record.commitJournal
			const nextRecord: CompactionRecoveryRecord = journal.requiresAdoption
				? {
						...record,
						phase: "commit_pending",
						canonicalAppliedCheckpointId: journal.checkpointId,
					}
				: {
						...record,
						phase: "completed",
						canonicalAppliedCheckpointId: journal.checkpointId,
						committedCheckpointId: journal.checkpointId,
						commitJournal: undefined,
						lastCompletedCommitJournalId: journal.journalId,
					}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(nextRecord))
			return this.loadFromHead<Payload>(await this.readHead(operationId))
		})
	}

	async completeCommit<Payload>(operationId: string, journalId: string): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		await this.ensureDirectories()
		const headPath = operationHeadPath(this.directoryPath, operationId)
		return this.fileLock.withLock(headPath, async () => {
			const record = await this.readHead(operationId)
			if (!record.commitJournal) {
				if (record.lastCompletedCommitJournalId === journalId) return this.loadFromHead<Payload>(record)
				throw new CompactionCheckpointConflictError("Compaction commit journal is unavailable or stale")
			}
			const journal = record.commitJournal
			if (
				journal.journalId !== journalId ||
				!journal.requiresAdoption ||
				record.canonicalAppliedCheckpointId !== journal.checkpointId
			) {
				throw new CompactionCheckpointConflictError("Compaction adoption completion is stale")
			}
			const completed: CompactionRecoveryRecord = {
				...record,
				phase: "completed",
				committedCheckpointId: journal.checkpointId,
				commitJournal: undefined,
				lastCompletedCommitJournalId: journal.journalId,
			}
			await writeAtomicFile(headPath, serializeCompactionCheckpointValue(completed))
			return this.loadFromHead<Payload>(await this.readHead(operationId))
		})
	}

	async loadOperation<Payload>(operationId: string): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		return this.loadFromHead<Payload>(await this.readHead(operationId))
	}

	async loadOperationIfPresent<Payload>(
		operationId: string,
	): Promise<LoadedCompactionCheckpointOperation<Payload> | undefined> {
		const head = await this.readHeadIfPresent(operationId)
		return head ? this.loadFromHead<Payload>(head) : undefined
	}

	async listOperations<Payload>(): Promise<LoadedCompactionCheckpointOperation<Payload>[]> {
		await this.ensureDirectories()
		const operationsDirectory = path.join(this.directoryPath, "operations")
		const entries = await fs.readdir(operationsDirectory, { withFileTypes: true })
		const operations: LoadedCompactionCheckpointOperation<Payload>[] = []
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".head.json")) continue
			const raw = await fs.readFile(path.join(operationsDirectory, entry.name), "utf8")
			let parsed: unknown
			try {
				parsed = JSON.parse(raw)
			} catch (error) {
				throw integrityError(
					`operation head is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			if (!isRecord(parsed) || typeof parsed.operationId !== "string" || !parsed.operationId.trim()) {
				throw integrityError("operation head is missing its operation identity")
			}
			operations.push(await this.loadFromHead<Payload>(parseCheckpointHead(raw, parsed.operationId)))
		}
		return operations.sort((left, right) => left.head.operationId.localeCompare(right.head.operationId))
	}

	async readCheckpoint<Payload>(checkpointId: string): Promise<StoredCompactionCheckpoint<Payload>> {
		const filePath = artifactPathForCheckpoint(this.directoryPath, checkpointId)
		let raw: string
		try {
			raw = await fs.readFile(filePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw integrityError(`checkpoint artifact is missing: ${checkpointId}`)
			}
			throw error
		}
		let checkpoint: unknown
		try {
			checkpoint = JSON.parse(raw)
		} catch (error) {
			throw integrityError(
				`checkpoint artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		if (!isRecord(checkpoint) || checkpoint.checkpointId !== checkpointId || !isRecord(checkpoint.artifact)) {
			throw integrityError("checkpoint artifact identity or schema does not match its path")
		}
		const stored = checkpoint as unknown as StoredCompactionCheckpoint<Payload>
		verifyStoredCompactionCheckpoint(stored)
		return stored
	}

	private async ensureDirectories(): Promise<void> {
		await Promise.all([
			fs.mkdir(path.join(this.directoryPath, "artifacts"), { recursive: true }),
			fs.mkdir(path.join(this.directoryPath, "operations"), { recursive: true }),
		])
	}

	private async readHeadIfPresent(operationId: string): Promise<CompactionRecoveryRecord | undefined> {
		try {
			return await this.readHead(operationId)
		} catch (error) {
			if (error instanceof CompactionCheckpointIntegrityError && error.message.includes("operation head is missing")) {
				return undefined
			}
			throw error
		}
	}

	private async readHead(operationId: string): Promise<CompactionRecoveryRecord> {
		const filePath = operationHeadPath(this.directoryPath, operationId)
		try {
			return parseCheckpointHead(await fs.readFile(filePath, "utf8"), operationId)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw integrityError(`operation head is missing: ${operationId}`)
			}
			throw error
		}
	}

	private async writeImmutableCheckpoint(checkpoint: StoredCompactionCheckpoint): Promise<void> {
		verifyStoredCompactionCheckpoint(checkpoint)
		const filePath = artifactPathForCheckpoint(this.directoryPath, checkpoint.checkpointId)
		const serialized = serializeCompactionCheckpointValue(checkpoint)
		await this.fileLock.withLock(filePath, async () => {
			try {
				const existing = await fs.readFile(filePath, "utf8")
				if (existing !== serialized) {
					throw integrityError(
						`immutable checkpoint artifact already exists with different bytes: ${checkpoint.checkpointId}`,
					)
				}
				const loaded = JSON.parse(existing) as StoredCompactionCheckpoint
				verifyStoredCompactionCheckpoint(loaded)
				return
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			}
			await writeAtomicFile(filePath, serialized)
			const readBack = await this.readCheckpoint(checkpoint.checkpointId)
			if (serializeCompactionCheckpointValue(readBack) !== serialized) {
				throw integrityError(`checkpoint artifact readback differs after durable write: ${checkpoint.checkpointId}`)
			}
		})
	}

	private assertExpectedHead(record: CompactionRecoveryRecord, checkpointId: string, chainRevision: number): void {
		if (record.headCheckpointId !== checkpointId || record.chainRevision !== chainRevision) {
			throw new CompactionCheckpointConflictError("Compaction checkpoint head or revision is stale")
		}
	}

	private assertCheckpointBelongsToOperation(checkpoint: StoredCompactionCheckpoint, record: CompactionRecoveryRecord): void {
		const rootCheckpointId =
			checkpoint.artifact.kind === "root" ? checkpoint.checkpointId : checkpoint.artifact.rootCheckpointId
		if (checkpoint.artifact.operationId !== record.operationId || rootCheckpointId !== record.rootCheckpointId) {
			throw new CompactionCheckpointConflictError("Compaction checkpoint does not belong to the requested operation")
		}
	}

	private async loadFromHead<Payload>(head: CompactionRecoveryRecord): Promise<LoadedCompactionCheckpointOperation<Payload>> {
		const root = await this.readCheckpoint<Payload>(head.rootCheckpointId)
		const current =
			head.headCheckpointId === head.rootCheckpointId ? root : await this.readCheckpoint<Payload>(head.headCheckpointId)
		if (root.artifact.kind !== "root" || root.artifact.operationId !== head.operationId) {
			throw integrityError("C0 does not match the operation head")
		}
		if (
			current.artifact.operationId !== head.operationId ||
			current.artifact.chainRevision > head.chainRevision ||
			current.artifact.sequence > head.sequence ||
			current.artifact.depth !== head.depth ||
			(current.artifact.kind === "pass" && current.artifact.rootCheckpointId !== root.checkpointId) ||
			(current.artifact.chainRevision === head.chainRevision && current.artifact.branchId !== head.branchId)
		) {
			throw integrityError("current checkpoint does not match the operation head")
		}
		return {
			head: selectCheckpointHead(head),
			root,
			current,
			phase: head.phase,
			detachedBranchIds: [...head.detachedBranchIds],
			restoreJournal: head.restoreJournal,
			commitJournal: head.commitJournal,
			canonicalAppliedCheckpointId: head.canonicalAppliedCheckpointId,
			committedCheckpointId: head.committedCheckpointId,
			lastCompletedRestoreJournalId: head.lastCompletedRestoreJournalId,
			lastCompletedCommitJournalId: head.lastCompletedCommitJournalId,
		}
	}
}

function selectCheckpointHead(record: CompactionCheckpointHead): CompactionCheckpointHead {
	return {
		schemaVersion: record.schemaVersion,
		operationId: record.operationId,
		rootCheckpointId: record.rootCheckpointId,
		headCheckpointId: record.headCheckpointId,
		branchId: record.branchId,
		chainRevision: record.chainRevision,
		sequence: record.sequence,
		depth: record.depth,
	}
}

export function artifactPathForCheckpoint(directoryPath: string, checkpointId: string): string {
	if (!/^sha256:[a-f0-9]{64}$/.test(checkpointId)) {
		throw integrityError("checkpoint path requires a valid SHA-256 identity")
	}
	return path.join(directoryPath, "artifacts", `${checkpointId.replace(/^sha256:/, "")}.json`)
}
