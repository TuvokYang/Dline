import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { commitCompactionCheckpoint } from "@core/context/context-management/fitting-commit"
import { FittingRecoveryStore } from "@core/context/context-management/fitting-recovery-store"
import { prepareCompactionCheckpointRestore } from "@core/context/context-management/fitting-restore"
import type { TargetWindowFittingState } from "@core/context/context-management/target-window-fitting"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextCompactionCheckpointPayload } from "../ContextCompactionCheckpoint"
import type { ContextCompactionRecoveryAdapter } from "../ContextCompactionRecoveryAdapter"
import {
	ContextCompactionRecoveryCoordinator,
	type ContextCompactionRecoveryCoordinatorPorts,
} from "../ContextCompactionRecoveryCoordinator"
import type { ContextCompactionSession, ContextCompactionSessionRestoreRequest } from "../ContextCompactionSession"

const operationId = "operation-coordinator"
const attempt = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }

function fittingState(passIndex = 0): TargetWindowFittingState {
	return {
		operationId,
		sourceHistory: [],
		turns: [],
		protectedTail: [],
		coveredTurnCount: passIndex,
		passIndex,
		passStartTurnIndex: passIndex,
		passEndTurnIndex: passIndex,
		cumulativeSummary: passIndex === 0 ? "" : `summary-${passIndex}`,
		summaryBaselineHash: passIndex === 0 ? "empty" : `summary-${passIndex - 1}`,
		passPlanned: false,
	}
}

function payload(kind: "root" | "pass", passIndex = 0): ContextCompactionCheckpointPayload {
	const state = fittingState(passIndex)
	return {
		schemaVersion: 1,
		kind,
		taskId: "task-coordinator",
		operationId,
		trigger: "profile_switch",
		canonicalHistory: [{ role: "user", content: "full context" }],
		conversationHistoryDeletedRange: [1, 2],
		fittingState: state,
		materializedHistory: [{ role: "user", content: kind === "root" ? "full context" : `summary-${passIndex}` }],
		materializedDeletedRange: kind === "root" ? [1, 2] : undefined,
		canonicalCommitHistory: [{ role: "user", content: kind === "root" ? "full context" : `summary-${passIndex}` }],
		canonicalCommitDeletedRange: kind === "root" ? [1, 2] : undefined,
		protectedContinuation: [],
		passGuidance: [],
		ordinaryInput: [],
		runtimeSnapshot: {
			version: 2,
			taskId: "task-coordinator",
			phase: "idle" as never,
			apiIndex: 0,
			timestamp: 1,
			revision: 1,
			anchor: { apiIndex: 0 },
		},
		manualState: {},
		oneShotState: { recentlyModifiedFiles: { files: [], revisions: {} } },
		transition: {
			kind: "profile_switch",
			operationId,
			phase: "compacting",
			source: { mode: "act", profile: "source-profile" },
			sourceProfiles: { act: "source-profile" },
			target: { mode: "act", profile: "target-profile", contextWindow: 128_000 },
			targetModes: ["act"],
		},
		sourceScope: {
			mode: "act",
			profile: "source-profile",
			providerId: "source-provider",
			modelId: "source-model",
			contextWindow: 1_000_000,
			fingerprint: "source-fingerprint",
		},
		targetScope: {
			mode: "act",
			profile: "target-profile",
			providerId: "target-provider",
			modelId: "target-model",
			contextWindow: 128_000,
			fingerprint: "target-fingerprint",
		},
		indicator: {
			revision: 0,
			phase: "durable",
			durableContextTokens: 100,
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: 0,
			contextWindow: 1_000_000,
			source: "legacy_unsegmented",
			requestPressures: [],
		},
	}
}

async function appendPass(store: FittingRecoveryStore) {
	const root = await store.createRoot({ operationId, branchId: "branch-0", payload: payload("root") })
	const pass = await store.appendCheckpoint({
		operationId,
		expectedHeadCheckpointId: root.head.headCheckpointId,
		expectedChainRevision: root.head.chainRevision,
		passIdentity: {
			operationId,
			passIndex: 0,
			passStartTurnIndex: 0,
			passEndTurnIndex: 0,
			coveredTurnCount: 0,
			summaryBaselineHash: "empty",
			passHistoryHash: "history-0",
		},
		attempt,
		payload: payload("pass", 1),
	})
	return { root, pass }
}

function createHarness(store: FittingRecoveryStore, activeOperationId?: string) {
	const adapter = {
		applyRestore: vi.fn(async () => undefined),
		applyCanonical: vi.fn(async () => undefined),
		applyTransition: vi.fn(async () => undefined),
	} as unknown as ContextCompactionRecoveryAdapter
	const onRecoveryFailure = vi.fn()
	const sessionRestore = vi.fn(async (_operationId: string, request: ContextCompactionSessionRestoreRequest) => {
		await request.prepare()
		expect((await store.loadOperation(operationId)).phase).toBe("restore_pending")
		await request.apply()
	})
	const session = {
		getActiveOperationId: vi.fn(() => activeOperationId),
		restore: sessionRestore,
	} as unknown as ContextCompactionSession
	const ports: ContextCompactionRecoveryCoordinatorPorts = {
		store: async () => store,
		adapter: () => adapter,
		session: () => session,
		onRecoveryFailure,
	}
	return { coordinator: new ContextCompactionRecoveryCoordinator(ports), adapter, sessionRestore, onRecoveryFailure }
}

describe("ContextCompactionRecoveryCoordinator", () => {
	let directoryPath: string
	let store: FittingRecoveryStore

	beforeEach(async () => {
		directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "dline-context-recovery-coordinator-"))
		store = new FittingRecoveryStore(directoryPath)
	})

	afterEach(async () => {
		await fs.rm(directoryPath, { recursive: true, force: true })
	})

	it("restores an inactive operation through the durable adapter and moves head to a new branch", async () => {
		const { root, pass } = await appendPass(store)
		const { coordinator, adapter, sessionRestore } = createHarness(store)

		const restored = await coordinator.restore({
			operationId,
			target: { kind: "initial" },
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
		})

		expect(sessionRestore).not.toHaveBeenCalled()
		expect(adapter.applyRestore).toHaveBeenCalledOnce()
		expect(restored).toMatchObject({
			checkpointId: root.root.checkpointId,
			phase: "prepared",
			head: { headCheckpointId: root.root.checkpointId, chainRevision: pass.head.chainRevision + 1 },
		})
		expect(restored.head.branchId).not.toBe(pass.head.branchId)
	})

	it("uses the active Session two-phase interrupt before applying a restore", async () => {
		const { root, pass } = await appendPass(store)
		const { coordinator, adapter, sessionRestore } = createHarness(store, operationId)

		const restored = await coordinator.restore({
			operationId,
			target: { kind: "checkpoint", checkpointId: root.root.checkpointId },
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
		})

		expect(sessionRestore).toHaveBeenCalledOnce()
		expect(adapter.applyRestore).toHaveBeenCalledOnce()
		expect(restored.head.headCheckpointId).toBe(root.root.checkpointId)
	})

	it("rejects barrier release while a transition commit journal has not applied canonical state", async () => {
		const { pass } = await appendPass(store)
		await store.beginCommit({
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: true,
		})
		const { coordinator } = createHarness(store, operationId)

		await expect(coordinator.completeAdoption(operationId)).rejects.toThrow(
			"Context compaction adoption journal is not ready for barrier release.",
		)
		expect((await store.loadOperation(operationId)).phase).toBe("commit_pending")
	})

	it("completes the matching transition adoption journal before the Session barrier is released", async () => {
		const { pass } = await appendPass(store)
		const pending = await commitCompactionCheckpoint<ContextCompactionCheckpointPayload>({
			store,
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: true,
			applyCanonical: async () => undefined,
		})
		const { coordinator } = createHarness(store, operationId)

		await coordinator.completeAdoption(operationId)

		const completed = await store.loadOperation(operationId)
		expect(pending.status).toBe("awaiting_adoption")
		expect(completed).toMatchObject({
			phase: "completed",
			committedCheckpointId: pass.current.checkpointId,
			commitJournal: undefined,
		})
	})

	it("restores C0 when resumed transition adoption fails", async () => {
		const { root, pass } = await appendPass(store)
		await commitCompactionCheckpoint<ContextCompactionCheckpointPayload>({
			store,
			operationId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
			requiresAdoption: true,
			applyCanonical: async () => undefined,
		})
		const harness = createHarness(store)
		vi.mocked(harness.adapter.applyTransition).mockRejectedValueOnce(new Error("target adoption failed"))

		await harness.coordinator.resumePendingJournals()

		expect(harness.adapter.applyRestore).toHaveBeenCalledOnce()
		expect(harness.onRecoveryFailure).toHaveBeenCalledWith(operationId, expect.any(Error))
		expect(await store.loadOperation(operationId)).toMatchObject({
			phase: "cancelled",
			commitJournal: undefined,
			committedCheckpointId: undefined,
			head: { headCheckpointId: root.root.checkpointId },
		})
	})

	it("rolls pending restore and transition adoption journals forward during locked history preparation", async () => {
		const { root, pass } = await appendPass(store)
		await prepareCompactionCheckpointRestore<ContextCompactionCheckpointPayload>({
			store,
			operationId,
			checkpointId: root.root.checkpointId,
			expectedHeadCheckpointId: pass.head.headCheckpointId,
			expectedChainRevision: pass.head.chainRevision,
		})
		const restoreHarness = createHarness(store)
		await restoreHarness.coordinator.resumePendingJournals()
		expect(restoreHarness.adapter.applyRestore).toHaveBeenCalledOnce()
		expect((await store.loadOperation(operationId)).phase).toBe("prepared")

		const restored = await store.loadOperation<ContextCompactionCheckpointPayload>(operationId)
		const branched = await store.appendCheckpoint({
			operationId,
			expectedHeadCheckpointId: restored.head.headCheckpointId,
			expectedChainRevision: restored.head.chainRevision,
			passIdentity: {
				operationId,
				passIndex: 0,
				passStartTurnIndex: 0,
				passEndTurnIndex: 0,
				coveredTurnCount: 0,
				summaryBaselineHash: "empty",
				passHistoryHash: "history-resumed",
			},
			attempt,
			payload: payload("pass", 1),
		})
		await commitCompactionCheckpoint<ContextCompactionCheckpointPayload>({
			store,
			operationId,
			expectedHeadCheckpointId: branched.head.headCheckpointId,
			expectedChainRevision: branched.head.chainRevision,
			requiresAdoption: true,
			applyCanonical: async () => undefined,
		})
		const adoptionHarness = createHarness(store)
		await adoptionHarness.coordinator.resumePendingJournals()

		expect(adoptionHarness.adapter.applyTransition).toHaveBeenCalledWith(expect.objectContaining({ kind: "pass" }), "target")
		expect((await store.loadOperation(operationId)).phase).toBe("completed")
	})
})
