import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CompactionCheckpointConflictError } from "../compaction-checkpoint-chain"
import { FittingRecoveryStore } from "../fitting-recovery-store"
import {
	restoreInitialCompactionCheckpoint,
	restorePreviousCompactionCheckpoint,
	resumePendingCompactionRestore,
} from "../fitting-restore"

const operationId = "operation-restore"
const attempt = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }

function passIdentity(passIndex: number) {
	return {
		operationId,
		passIndex,
		passStartTurnIndex: passIndex,
		passEndTurnIndex: passIndex,
		coveredTurnCount: passIndex,
		summaryBaselineHash: `summary-${passIndex}`,
		passHistoryHash: `history-${passIndex}`,
	}
}

async function append(
	store: FittingRecoveryStore,
	expected: Awaited<ReturnType<FittingRecoveryStore["loadOperation"]>>,
	value: number,
) {
	return store.appendCheckpoint({
		operationId,
		expectedHeadCheckpointId: expected.head.headCheckpointId,
		expectedChainRevision: expected.head.chainRevision,
		passIdentity: passIdentity(value - 1),
		attempt,
		payload: { value },
	})
}

describe("compaction checkpoint restore", () => {
	let directoryPath: string
	let store: FittingRecoveryStore

	beforeEach(async () => {
		directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "dline-fitting-restore-"))
		store = new FittingRecoveryStore(directoryPath)
	})

	afterEach(async () => {
		await fs.rm(directoryPath, { recursive: true, force: true })
	})

	it("restores the previous checkpoint onto a new branch while keeping revision and sequence monotonic", async () => {
		const root = await store.createRoot({ operationId, branchId: "branch-0", payload: { value: 0 } })
		const first = await append(store, root, 1)
		const second = await append(store, first, 2)
		const applied: number[] = []

		const restored = await restorePreviousCompactionCheckpoint<{ value: number }>({
			store,
			operationId,
			expectedHeadCheckpointId: second.head.headCheckpointId,
			expectedChainRevision: second.head.chainRevision,
			apply: async (payload) => {
				applied.push(payload.value)
			},
		})

		expect(applied).toEqual([1])
		expect(restored.head).toMatchObject({
			headCheckpointId: first.current.checkpointId,
			chainRevision: second.head.chainRevision + 1,
			sequence: second.head.sequence + 1,
			depth: first.current.artifact.depth,
		})
		expect(restored.head.branchId).not.toBe(second.head.branchId)
		expect(restored.detachedBranchIds).toContain(second.head.branchId)

		const branched = await append(store, restored, 3)
		expect(branched.current.artifact).toMatchObject({
			parentCheckpointId: first.current.checkpointId,
			branchId: restored.head.branchId,
			sequence: restored.head.sequence + 1,
			depth: first.current.artifact.depth + 1,
		})
		await expect(
			store.appendCheckpoint({
				operationId,
				expectedHeadCheckpointId: second.head.headCheckpointId,
				expectedChainRevision: second.head.chainRevision,
				passIdentity: passIdentity(3),
				attempt,
				payload: { value: 4 },
			}),
		).rejects.toBeInstanceOf(CompactionCheckpointConflictError)
	})

	it("rejects a late accepted Pass while restore_pending keeps ownership of the expected head", async () => {
		const root = await store.createRoot({ operationId, branchId: "branch-0", payload: { value: 0 } })
		const first = await append(store, root, 1)
		await store.beginRestore({
			operationId,
			targetCheckpointId: root.root.checkpointId,
			expectedHeadCheckpointId: first.head.headCheckpointId,
			expectedChainRevision: first.head.chainRevision,
			canonicalRestoreRequired: false,
		})

		await expect(append(store, first, 2)).rejects.toBeInstanceOf(CompactionCheckpointConflictError)
		const pending = await store.loadOperation(operationId)
		expect(pending.phase).toBe("restore_pending")
		expect(pending.restoreJournal).toMatchObject({
			sourceHead: first.head,
			targetCheckpointId: root.root.checkpointId,
		})
	})

	it("journals a cancelled C0 restore even when C0 is already the current head", async () => {
		const root = await store.createRoot({ operationId, branchId: "branch-0", payload: { value: 0 } })
		let applyCount = 0

		const restored = await restoreInitialCompactionCheckpoint<{ value: number }>({
			store,
			operationId,
			expectedHeadCheckpointId: root.head.headCheckpointId,
			expectedChainRevision: root.head.chainRevision,
			completionPhase: "cancelled",
			apply: async (payload, context) => {
				applyCount++
				expect(payload).toEqual({ value: 0 })
				expect(context.completionPhase).toBe("cancelled")
			},
		})

		expect(applyCount).toBe(1)
		expect(restored).toMatchObject({
			phase: "cancelled",
			head: {
				headCheckpointId: root.root.checkpointId,
				chainRevision: root.head.chainRevision + 1,
				sequence: root.head.sequence + 1,
			},
		})
		expect(restored.head.branchId).not.toBe(root.head.branchId)
		expect(restored.detachedBranchIds).toContain(root.head.branchId)
	})

	it("retains restore_pending after apply failure and rolls it forward without moving head twice", async () => {
		const root = await store.createRoot({ operationId, branchId: "branch-0", payload: { value: 0 } })
		const first = await append(store, root, 1)
		let attempts = 0

		await expect(
			restoreInitialCompactionCheckpoint<{ value: number }>({
				store,
				operationId,
				expectedHeadCheckpointId: first.head.headCheckpointId,
				expectedChainRevision: first.head.chainRevision,
				apply: async () => {
					attempts++
					throw new Error("apply interrupted")
				},
			}),
		).rejects.toThrow("apply interrupted")

		const pending = await store.loadOperation<{ value: number }>(operationId)
		expect(pending.head).toEqual(first.head)
		expect(pending.phase).toBe("restore_pending")
		expect(pending.restoreJournal).toMatchObject({ targetCheckpointId: root.root.checkpointId })

		const resumed = await resumePendingCompactionRestore<{ value: number }>({
			store,
			operationId,
			apply: async (payload) => {
				attempts++
				expect(payload).toEqual({ value: 0 })
			},
		})

		expect(attempts).toBe(2)
		expect(resumed?.head).toMatchObject({
			headCheckpointId: root.root.checkpointId,
			chainRevision: first.head.chainRevision + 1,
			sequence: first.head.sequence + 1,
			depth: 0,
		})
		expect((await store.loadOperation(operationId)).restoreJournal).toBeUndefined()
	})
})
