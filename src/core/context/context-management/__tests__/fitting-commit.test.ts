import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commitCompactionCheckpoint, completeCompactionCommit, resumePendingCompactionCommit } from "../fitting-commit"
import { FittingRecoveryStore } from "../fitting-recovery-store"
import { restoreInitialCompactionCheckpoint } from "../fitting-restore"

const operationId = "operation-commit"
const passIdentity = {
	operationId,
	passIndex: 0,
	passStartTurnIndex: 0,
	passEndTurnIndex: 0,
	coveredTurnCount: 0,
	summaryBaselineHash: "summary-0",
	passHistoryHash: "history-0",
}
const attempt = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }

async function operationWithPass(store: FittingRecoveryStore) {
	const root = await store.createRoot({ operationId, branchId: "branch-0", payload: { value: "full" } })
	const pass = await store.appendCheckpoint({
		operationId,
		expectedHeadCheckpointId: root.head.headCheckpointId,
		expectedChainRevision: root.head.chainRevision,
		passIdentity,
		attempt,
		payload: { value: "summary" },
	})
	return { root, pass }
}

describe("compaction checkpoint commit", () => {
	let directoryPath: string
	let store: FittingRecoveryStore

	beforeEach(async () => {
		directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "dline-fitting-commit-"))
		store = new FittingRecoveryStore(directoryPath)
	})

	afterEach(async () => {
		await fs.rm(directoryPath, { recursive: true, force: true })
	})

	it("rolls a non-transition canonical commit forward and retains the chain for restore", async () => {
		const { root, pass } = await operationWithPass(store)
		const applied: string[] = []

		const committed = await commitCompactionCheckpoint<{ value: string }>({
			store,
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: false,
			applyCanonical: async (payload) => {
				applied.push(payload.value)
			},
		})

		expect(applied).toEqual(["summary"])
		expect(committed.status).toBe("completed")
		expect(committed.operation).toMatchObject({
			phase: "completed",
			committedCheckpointId: pass.current.checkpointId,
		})
		expect(await store.readCheckpoint(root.root.checkpointId)).toEqual(root.root)

		const restored = await restoreInitialCompactionCheckpoint<{ value: string }>({
			store,
			operationId,
			expectedHeadCheckpointId: committed.operation.head.headCheckpointId,
			expectedChainRevision: committed.operation.head.chainRevision,
			apply: async (payload, context) => {
				expect(payload.value).toBe("full")
				expect(context.canonicalRestoreRequired).toBe(true)
			},
		})
		expect(restored).toMatchObject({
			phase: "prepared",
			canonicalAppliedCheckpointId: undefined,
			committedCheckpointId: undefined,
			head: { headCheckpointId: root.root.checkpointId },
		})
	})

	it("keeps transition commit awaiting adoption until the matching journal is completed", async () => {
		const { pass } = await operationWithPass(store)
		const pending = await commitCompactionCheckpoint<{ value: string }>({
			store,
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: true,
			applyCanonical: async () => undefined,
		})

		expect(pending.status).toBe("awaiting_adoption")
		expect(pending.operation).toMatchObject({ phase: "commit_pending", committedCheckpointId: undefined })
		const completed = await completeCompactionCommit({
			store,
			operationId,
			journalId: pending.journalId,
		})
		expect(completed).toMatchObject({ phase: "completed", committedCheckpointId: pass.current.checkpointId })
		expect(completed.commitJournal).toBeUndefined()
	})

	it("allows adoption failure to supersede an awaiting commit with a cancelled C0 restore", async () => {
		const { root, pass } = await operationWithPass(store)
		const pending = await commitCompactionCheckpoint<{ value: string }>({
			store,
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: true,
			applyCanonical: async () => undefined,
		})

		const restored = await restoreInitialCompactionCheckpoint<{ value: string }>({
			store,
			operationId,
			expectedHeadCheckpointId: pending.operation.head.headCheckpointId,
			expectedChainRevision: pending.operation.head.chainRevision,
			completionPhase: "cancelled",
			apply: async (payload, context) => {
				expect(payload.value).toBe("full")
				expect(context.canonicalRestoreRequired).toBe(true)
			},
		})

		expect(restored).toMatchObject({
			phase: "cancelled",
			commitJournal: undefined,
			committedCheckpointId: undefined,
			head: { headCheckpointId: root.root.checkpointId },
		})
	})

	it("retains commit_pending after canonical apply failure and replays it idempotently", async () => {
		const { pass } = await operationWithPass(store)
		let attempts = 0
		await expect(
			commitCompactionCheckpoint<{ value: string }>({
				store,
				operationId,
				expectedHeadCheckpointId: pass.head.headCheckpointId,
				expectedChainRevision: pass.head.chainRevision,
				requiresAdoption: false,
				applyCanonical: async () => {
					attempts++
					throw new Error("canonical write interrupted")
				},
			}),
		).rejects.toThrow("canonical write interrupted")

		expect((await store.loadOperation(operationId)).phase).toBe("commit_pending")
		const resumed = await resumePendingCompactionCommit<{ value: string }>({
			store,
			operationId,
			applyCanonical: async (payload) => {
				attempts++
				expect(payload.value).toBe("summary")
			},
		})
		expect(attempts).toBe(2)
		expect(resumed).toMatchObject({ status: "completed", operation: { phase: "completed" } })
	})
})
