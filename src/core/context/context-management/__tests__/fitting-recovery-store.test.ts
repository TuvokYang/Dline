import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CompactionCheckpointConflictError, CompactionCheckpointIntegrityError } from "../compaction-checkpoint-chain"
import { artifactPathForCheckpoint, FittingRecoveryStore } from "../fitting-recovery-store"

const passIdentity = {
	operationId: "operation-store",
	passIndex: 0,
	passStartTurnIndex: 0,
	passEndTurnIndex: 1,
	coveredTurnCount: 0,
	summaryBaselineHash: "sha256:empty",
	passHistoryHash: "sha256:history",
}

const attempt = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }

function c0Payload() {
	return {
		canonicalHistory: [{ role: "user", content: "full context" }],
		deletedRange: [1, 4],
		continuation: [{ type: "text", text: "draft" }],
		source: { mode: "act", profile: "source-profile" },
		indicator: { durableContextTokens: 123, pendingSendTokens: 0, receivingTokens: 0, environmentTokens: 9 },
	}
}

describe("FittingRecoveryStore", () => {
	let directoryPath: string
	let store: FittingRecoveryStore

	beforeEach(async () => {
		directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "dline-fitting-recovery-"))
		store = new FittingRecoveryStore(directoryPath)
	})

	afterEach(async () => {
		await fs.rm(directoryPath, { recursive: true, force: true })
	})

	it("durably creates and reloads a complete C0 before any Pass", async () => {
		const created = await store.createRoot({ operationId: "operation-store", branchId: "branch-0", payload: c0Payload() })
		const loaded = await store.loadOperation<ReturnType<typeof c0Payload>>("operation-store")

		expect(created.head).toMatchObject({
			operationId: "operation-store",
			rootCheckpointId: created.root.checkpointId,
			headCheckpointId: created.root.checkpointId,
			chainRevision: 0,
			sequence: 0,
			depth: 0,
		})
		expect(loaded.root.artifact.payload).toEqual(c0Payload())
		expect(loaded.current.checkpointId).toBe(created.root.checkpointId)
	})

	it("writes an immutable child before atomically moving the expected head", async () => {
		const root = await store.createRoot({ operationId: "operation-store", branchId: "branch-0", payload: c0Payload() })
		const childPayload = { ...c0Payload(), canonicalHistory: [{ role: "user", content: "summary plus tail" }] }
		const appended = await store.appendCheckpoint({
			operationId: "operation-store",
			expectedHeadCheckpointId: root.head.headCheckpointId,
			expectedChainRevision: root.head.chainRevision,
			passIdentity,
			attempt,
			payload: childPayload,
		})

		expect(appended.current.artifact).toMatchObject({
			kind: "pass",
			parentCheckpointId: root.root.checkpointId,
			rootCheckpointId: root.root.checkpointId,
			sequence: 1,
			depth: 1,
			chainRevision: 1,
		})
		expect((await store.loadOperation("operation-store")).head.headCheckpointId).toBe(appended.current.checkpointId)
	})

	it("rejects stale CAS and leaves the durable head unchanged", async () => {
		const root = await store.createRoot({ operationId: "operation-store", branchId: "branch-0", payload: c0Payload() })
		const first = await store.appendCheckpoint({
			operationId: "operation-store",
			expectedHeadCheckpointId: root.head.headCheckpointId,
			expectedChainRevision: 0,
			passIdentity,
			attempt,
			payload: { value: 1 },
		})

		await expect(
			store.appendCheckpoint({
				operationId: "operation-store",
				expectedHeadCheckpointId: root.head.headCheckpointId,
				expectedChainRevision: 0,
				passIdentity,
				attempt,
				payload: { value: 2 },
			}),
		).rejects.toBeInstanceOf(CompactionCheckpointConflictError)
		expect((await store.loadOperation("operation-store")).head.headCheckpointId).toBe(first.current.checkpointId)
	})

	it("does not move head when the next artifact cannot be serialized", async () => {
		const root = await store.createRoot({ operationId: "operation-store", branchId: "branch-0", payload: c0Payload() })
		const cyclic: { self?: unknown } = {}
		cyclic.self = cyclic

		await expect(
			store.appendCheckpoint({
				operationId: "operation-store",
				expectedHeadCheckpointId: root.head.headCheckpointId,
				expectedChainRevision: 0,
				passIdentity,
				attempt,
				payload: cyclic,
			}),
		).rejects.toThrow()
		expect((await store.loadOperation("operation-store")).head).toEqual(root.head)
	})

	it("refuses to load an operation when C0 is missing or corrupted", async () => {
		const created = await store.createRoot({ operationId: "operation-store", branchId: "branch-0", payload: c0Payload() })
		const artifactPath = artifactPathForCheckpoint(directoryPath, created.root.checkpointId)
		await fs.writeFile(
			artifactPath,
			JSON.stringify({ ...created.root, artifact: { ...created.root.artifact, payload: { bad: true } } }),
			"utf8",
		)

		await expect(store.loadOperation("operation-store")).rejects.toBeInstanceOf(CompactionCheckpointIntegrityError)
		await fs.rm(artifactPath)
		await expect(store.loadOperation("operation-store")).rejects.toThrow("missing")
	})
})
