import { describe, expect, it } from "vitest"
import {
	CompactionCheckpointConflictError,
	compareAndSwapCompactionCheckpointHead,
	createChildCompactionCheckpoint,
	createRootCompactionCheckpoint,
	createRootCompactionCheckpointHead,
	verifyStoredCompactionCheckpoint,
} from "../compaction-checkpoint-chain"

const passIdentity = {
	operationId: "operation-1",
	passIndex: 0,
	passStartTurnIndex: 0,
	passEndTurnIndex: 2,
	coveredTurnCount: 0,
	summaryBaselineHash: "sha256:empty",
	passHistoryHash: "sha256:history",
}

const attempt = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }

describe("compaction checkpoint chain", () => {
	it("creates an immutable C0 identity and advances one child through expected-head CAS", () => {
		const root = createRootCompactionCheckpoint({
			operationId: "operation-1",
			branchId: "branch-0",
			payload: { history: ["full context"], deletedRange: [1, 2] },
		})
		const rootHead = createRootCompactionCheckpointHead(root)
		const child = createChildCompactionCheckpoint({
			head: rootHead,
			parent: root,
			passIdentity,
			attempt,
			payload: { history: ["summary", "remaining context"], deletedRange: undefined },
		})
		const nextHead = compareAndSwapCompactionCheckpointHead(
			rootHead,
			{ headCheckpointId: root.checkpointId, chainRevision: 0 },
			child,
		)

		expect(root.checkpointId).toMatch(/^sha256:[a-f0-9]{64}$/)
		expect(root.artifact).toMatchObject({ kind: "root", sequence: 0, depth: 0, chainRevision: 0 })
		expect(child.artifact).toMatchObject({
			kind: "pass",
			parentCheckpointId: root.checkpointId,
			rootCheckpointId: root.checkpointId,
			sequence: 1,
			depth: 1,
			chainRevision: 1,
			passIdentity,
			attempt,
		})
		expect(nextHead).toMatchObject({
			rootCheckpointId: root.checkpointId,
			headCheckpointId: child.checkpointId,
			chainRevision: 1,
			sequence: 1,
			depth: 1,
		})
		verifyStoredCompactionCheckpoint(root)
		verifyStoredCompactionCheckpoint(child)
	})

	it("rejects stale expected head without advancing the chain", () => {
		const root = createRootCompactionCheckpoint({ operationId: "operation-1", branchId: "branch-0", payload: { value: 0 } })
		const rootHead = createRootCompactionCheckpointHead(root)
		const child = createChildCompactionCheckpoint({
			head: rootHead,
			parent: root,
			passIdentity,
			attempt,
			payload: { value: 1 },
		})
		const advanced = compareAndSwapCompactionCheckpointHead(
			rootHead,
			{ headCheckpointId: root.checkpointId, chainRevision: 0 },
			child,
		)

		expect(() =>
			compareAndSwapCompactionCheckpointHead(advanced, { headCheckpointId: root.checkpointId, chainRevision: 0 }, child),
		).toThrow(CompactionCheckpointConflictError)
	})

	it("detects payload or identity mutation after content addressing", () => {
		const root = createRootCompactionCheckpoint({ operationId: "operation-1", branchId: "branch-0", payload: { value: 0 } })
		const corrupted = {
			...root,
			artifact: { ...root.artifact, payload: { value: 1 } },
		}

		expect(() => verifyStoredCompactionCheckpoint(corrupted)).toThrow("integrity")
	})
})
