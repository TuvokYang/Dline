import { createHash } from "node:crypto"
import type { InternalCompactionAttemptIdentity } from "./internal-compaction-pass"
import type { CompactionPassIdentity } from "./target-window-fitting"

export const COMPACTION_CHECKPOINT_SCHEMA_VERSION = 1 as const

export interface CompactionCheckpointArtifact<Payload = unknown> {
	schemaVersion: typeof COMPACTION_CHECKPOINT_SCHEMA_VERSION
	kind: "root" | "pass"
	operationId: string
	branchId: string
	chainRevision: number
	sequence: number
	depth: number
	parentCheckpointId?: string
	rootCheckpointId?: string
	passIdentity?: CompactionPassIdentity
	attempt?: InternalCompactionAttemptIdentity
	payloadHash: string
	payload: Payload
}

export interface StoredCompactionCheckpoint<Payload = unknown> {
	checkpointId: string
	artifact: CompactionCheckpointArtifact<Payload>
}

export interface CompactionCheckpointHead {
	schemaVersion: typeof COMPACTION_CHECKPOINT_SCHEMA_VERSION
	operationId: string
	rootCheckpointId: string
	headCheckpointId: string
	branchId: string
	chainRevision: number
	sequence: number
	depth: number
}

export interface ExpectedCompactionCheckpointHead {
	headCheckpointId: string
	chainRevision: number
}

export class CompactionCheckpointConflictError extends Error {
	readonly code = "compaction_checkpoint_conflict"

	constructor(message: string) {
		super(message)
		this.name = "CompactionCheckpointConflictError"
	}
}

export class CompactionCheckpointIntegrityError extends Error {
	readonly code = "compaction_checkpoint_integrity_error"

	constructor(message: string) {
		super(message)
		this.name = "CompactionCheckpointIntegrityError"
	}
}

function integrityError(message: string): CompactionCheckpointIntegrityError {
	return new CompactionCheckpointIntegrityError(`Compaction checkpoint integrity error: ${message}`)
}

function normalizeJsonValue<Value>(value: Value): Value {
	try {
		const serialized = JSON.stringify(value)
		if (serialized === undefined) {
			throw integrityError("value is not JSON serializable")
		}
		return JSON.parse(serialized) as Value
	} catch (error) {
		if (error instanceof CompactionCheckpointIntegrityError) throw error
		throw integrityError(`value is not JSON serializable: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function stableSerializeNormalizedJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableSerializeNormalizedJson).join(",")}]`
	}
	const record = value as Record<string, unknown>
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableSerializeNormalizedJson(record[key])}`)
		.join(",")}}`
}

function assertNonEmpty(value: string, field: string): void {
	if (!value.trim()) throw integrityError(`${field} must be non-empty`)
}

function assertCounter(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw integrityError(`${field} must be a non-negative safe integer`)
	}
}

function assertSha256(value: string, field: string): void {
	if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
		throw integrityError(`${field} must be a SHA-256 identity`)
	}
}

function assertPassIdentity(passIdentity: CompactionPassIdentity, operationId: string): void {
	if (passIdentity.operationId !== operationId) {
		throw integrityError("Pass identity operation does not match its checkpoint operation")
	}
	for (const [field, value] of [
		["passIndex", passIdentity.passIndex],
		["passStartTurnIndex", passIdentity.passStartTurnIndex],
		["passEndTurnIndex", passIdentity.passEndTurnIndex],
		["coveredTurnCount", passIdentity.coveredTurnCount],
	] as const) {
		assertCounter(value, field)
	}
	if (passIdentity.passEndTurnIndex < passIdentity.passStartTurnIndex) {
		throw integrityError("Pass identity has an invalid logical-turn range")
	}
	assertNonEmpty(passIdentity.summaryBaselineHash, "summaryBaselineHash")
	if (passIdentity.passHistoryHash !== undefined) {
		assertNonEmpty(passIdentity.passHistoryHash, "passHistoryHash")
	}
	const hasSourceRange =
		passIdentity.sourceHistoryHash !== undefined ||
		passIdentity.passStartMessageIndex !== undefined ||
		passIdentity.passEndMessageIndex !== undefined ||
		passIdentity.rangeHash !== undefined
	if (hasSourceRange) {
		if (
			passIdentity.sourceHistoryHash === undefined ||
			passIdentity.passStartMessageIndex === undefined ||
			passIdentity.passEndMessageIndex === undefined ||
			passIdentity.rangeHash === undefined
		) {
			throw integrityError("Pass identity source-message range is incomplete")
		}
		assertSha256(passIdentity.sourceHistoryHash, "sourceHistoryHash")
		assertCounter(passIdentity.passStartMessageIndex, "passStartMessageIndex")
		assertCounter(passIdentity.passEndMessageIndex, "passEndMessageIndex")
		if (passIdentity.passEndMessageIndex < passIdentity.passStartMessageIndex) {
			throw integrityError("Pass identity has an invalid source-message range")
		}
		assertSha256(passIdentity.rangeHash, "rangeHash")
	}
}

function assertAttempt(attempt: InternalCompactionAttemptIdentity): void {
	assertCounter(attempt.attemptIndex, "attemptIndex")
	assertNonEmpty(attempt.authorizationAttemptId, "authorizationAttemptId")
}

export function createRootCompactionCheckpoint<Payload>(input: {
	operationId: string
	branchId: string
	payload: Payload
}): StoredCompactionCheckpoint<Payload> {
	assertNonEmpty(input.operationId, "operationId")
	assertNonEmpty(input.branchId, "branchId")
	const payload = normalizeJsonValue(input.payload)
	const artifact: CompactionCheckpointArtifact<Payload> = {
		schemaVersion: COMPACTION_CHECKPOINT_SCHEMA_VERSION,
		kind: "root",
		operationId: input.operationId,
		branchId: input.branchId,
		chainRevision: 0,
		sequence: 0,
		depth: 0,
		payloadHash: hashCompactionCheckpointValue(payload),
		payload,
	}
	return {
		checkpointId: hashCompactionCheckpointValue(artifact),
		artifact,
	}
}

export function createChildCompactionCheckpoint<Payload>(input: {
	head: CompactionCheckpointHead
	parent: StoredCompactionCheckpoint
	passIdentity: CompactionPassIdentity
	attempt: InternalCompactionAttemptIdentity
	payload: Payload
}): StoredCompactionCheckpoint<Payload> {
	verifyStoredCompactionCheckpoint(input.parent)
	if (
		input.head.headCheckpointId !== input.parent.checkpointId ||
		input.head.operationId !== input.parent.artifact.operationId
	) {
		throw new CompactionCheckpointConflictError("Compaction checkpoint parent is not the current durable head")
	}
	if (
		input.head.chainRevision < input.parent.artifact.chainRevision ||
		input.head.sequence < input.parent.artifact.sequence ||
		input.head.depth !== input.parent.artifact.depth
	) {
		throw integrityError("durable head counters cannot precede the parent artifact")
	}
	const parentRootCheckpointId =
		input.parent.artifact.kind === "root" ? input.parent.checkpointId : input.parent.artifact.rootCheckpointId
	if (input.head.rootCheckpointId !== parentRootCheckpointId) {
		throw integrityError("durable head root does not match the parent ancestry")
	}
	assertPassIdentity(input.passIdentity, input.head.operationId)
	assertAttempt(input.attempt)
	const payload = normalizeJsonValue(input.payload)
	const artifact: CompactionCheckpointArtifact<Payload> = {
		schemaVersion: COMPACTION_CHECKPOINT_SCHEMA_VERSION,
		kind: "pass",
		operationId: input.head.operationId,
		branchId: input.head.branchId,
		chainRevision: input.head.chainRevision + 1,
		sequence: input.head.sequence + 1,
		depth: input.parent.artifact.depth + 1,
		parentCheckpointId: input.parent.checkpointId,
		rootCheckpointId: input.head.rootCheckpointId,
		passIdentity: normalizeJsonValue(input.passIdentity),
		attempt: normalizeJsonValue(input.attempt),
		payloadHash: hashCompactionCheckpointValue(payload),
		payload,
	}
	return {
		checkpointId: hashCompactionCheckpointValue(artifact),
		artifact,
	}
}

export function createRootCompactionCheckpointHead(root: StoredCompactionCheckpoint): CompactionCheckpointHead {
	verifyStoredCompactionCheckpoint(root)
	if (root.artifact.kind !== "root") {
		throw integrityError("only a root checkpoint can initialize a durable head")
	}
	return {
		schemaVersion: COMPACTION_CHECKPOINT_SCHEMA_VERSION,
		operationId: root.artifact.operationId,
		rootCheckpointId: root.checkpointId,
		headCheckpointId: root.checkpointId,
		branchId: root.artifact.branchId,
		chainRevision: root.artifact.chainRevision,
		sequence: root.artifact.sequence,
		depth: root.artifact.depth,
	}
}

export function compareAndSwapCompactionCheckpointHead(
	current: CompactionCheckpointHead,
	expected: ExpectedCompactionCheckpointHead,
	next: StoredCompactionCheckpoint,
): CompactionCheckpointHead {
	if (current.headCheckpointId !== expected.headCheckpointId || current.chainRevision !== expected.chainRevision) {
		throw new CompactionCheckpointConflictError("Compaction checkpoint head or revision is stale")
	}
	verifyStoredCompactionCheckpoint(next)
	const artifact = next.artifact
	if (
		artifact.kind !== "pass" ||
		artifact.operationId !== current.operationId ||
		artifact.branchId !== current.branchId ||
		artifact.rootCheckpointId !== current.rootCheckpointId ||
		artifact.parentCheckpointId !== current.headCheckpointId ||
		artifact.chainRevision !== current.chainRevision + 1 ||
		artifact.sequence !== current.sequence + 1 ||
		artifact.depth !== current.depth + 1
	) {
		throw integrityError("next checkpoint does not extend the current durable head")
	}
	return {
		schemaVersion: COMPACTION_CHECKPOINT_SCHEMA_VERSION,
		operationId: current.operationId,
		rootCheckpointId: current.rootCheckpointId,
		headCheckpointId: next.checkpointId,
		branchId: current.branchId,
		chainRevision: artifact.chainRevision,
		sequence: artifact.sequence,
		depth: artifact.depth,
	}
}

export function verifyStoredCompactionCheckpoint(checkpoint: StoredCompactionCheckpoint): void {
	assertSha256(checkpoint.checkpointId, "checkpointId")
	const artifact = checkpoint.artifact
	if (artifact.schemaVersion !== COMPACTION_CHECKPOINT_SCHEMA_VERSION) {
		throw integrityError("unsupported checkpoint schema version")
	}
	assertNonEmpty(artifact.operationId, "operationId")
	assertNonEmpty(artifact.branchId, "branchId")
	assertCounter(artifact.chainRevision, "chainRevision")
	assertCounter(artifact.sequence, "sequence")
	assertCounter(artifact.depth, "depth")
	assertSha256(artifact.payloadHash, "payloadHash")
	if (artifact.payloadHash !== hashCompactionCheckpointValue(artifact.payload)) {
		throw integrityError("payload hash does not match the materialized payload")
	}
	if (artifact.kind === "root") {
		if (
			artifact.chainRevision !== 0 ||
			artifact.sequence !== 0 ||
			artifact.depth !== 0 ||
			artifact.parentCheckpointId !== undefined ||
			artifact.rootCheckpointId !== undefined ||
			artifact.passIdentity !== undefined ||
			artifact.attempt !== undefined
		) {
			throw integrityError("root checkpoint contains invalid ancestry or Pass metadata")
		}
	} else if (artifact.kind === "pass") {
		if (!artifact.parentCheckpointId || !artifact.rootCheckpointId || !artifact.passIdentity || !artifact.attempt) {
			throw integrityError("Pass checkpoint is missing ancestry or attempt metadata")
		}
		assertSha256(artifact.parentCheckpointId, "parentCheckpointId")
		assertSha256(artifact.rootCheckpointId, "rootCheckpointId")
		assertPassIdentity(artifact.passIdentity, artifact.operationId)
		assertAttempt(artifact.attempt)
		if (artifact.chainRevision === 0 || artifact.sequence === 0 || artifact.depth === 0) {
			throw integrityError("Pass checkpoint counters must advance beyond C0")
		}
	} else {
		throw integrityError("unknown checkpoint kind")
	}
	if (checkpoint.checkpointId !== hashCompactionCheckpointValue(artifact)) {
		throw integrityError("checkpoint identity does not match its artifact")
	}
}

export function hashCompactionCheckpointValue(value: unknown): string {
	return `sha256:${createHash("sha256").update(serializeCompactionCheckpointValue(value), "utf8").digest("hex")}`
}

export function serializeCompactionCheckpointValue(value: unknown): string {
	return stableSerializeNormalizedJson(normalizeJsonValue(value))
}
