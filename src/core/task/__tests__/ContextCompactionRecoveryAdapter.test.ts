import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { CompactionCommitContext } from "@core/context/context-management/fitting-commit"
import type { CompactionRestoreContext } from "@core/context/context-management/fitting-restore"
import { describe, expect, it, vi } from "vitest"
import type { ContextCompactionCheckpointPayload } from "../ContextCompactionCheckpoint"
import { ContextCompactionRecoveryAdapter, type ContextCompactionRecoveryPorts } from "../ContextCompactionRecoveryAdapter"

function head(overrides: Partial<CompactionCheckpointHead> = {}): CompactionCheckpointHead {
	return {
		schemaVersion: 1,
		operationId: "operation-adapter",
		rootCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		headCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		branchId: "branch-1",
		chainRevision: 3,
		sequence: 3,
		depth: 1,
		...overrides,
	}
}

function payload(kind: "root" | "pass"): ContextCompactionCheckpointPayload {
	return {
		schemaVersion: 1,
		kind,
		taskId: "task-1",
		operationId: "operation-adapter",
		trigger: "profile_switch",
		canonicalHistory: [{ role: "user", content: "full" }],
		conversationHistoryDeletedRange: [1, 2],
		fittingState: {
			operationId: "operation-adapter",
			sourceHistory: [],
			turns: [],
			protectedTail: [],
			coveredTurnCount: 0,
			passIndex: 0,
			passStartTurnIndex: 0,
			passEndTurnIndex: 0,
			cumulativeSummary: "",
			summaryBaselineHash: "empty",
			passPlanned: false,
		},
		materializedHistory: [{ role: "user", content: kind === "root" ? "full" : "staged" }],
		materializedDeletedRange: kind === "root" ? [1, 2] : undefined,
		canonicalCommitHistory: [{ role: "user", content: kind === "root" ? "full" : "summary" }],
		canonicalCommitDeletedRange: kind === "root" ? [1, 2] : undefined,
		protectedContinuation: [{ type: "text", text: "continuation" }],
		passGuidance: [],
		ordinaryInput: [{ type: "text", text: "draft" }],
		uiMessageBoundary: { count: 4, lastMessageTs: 400 },
		runtimeSnapshot: {
			version: 2,
			taskId: "task-1",
			phase: "idle" as never,
			apiIndex: 0,
			timestamp: 1,
			revision: 1,
			anchor: { apiIndex: 0 },
		},
		manualState: { pendingManualCompactionContinuation: { text: "feedback", images: [], files: [] } },
		oneShotState: { recentlyModifiedFiles: { files: ["a.ts"], revisions: { "a.ts": 1 } } },
		transition: {
			kind: "profile_switch",
			operationId: "operation-adapter",
			phase: "compacting",
			source: { mode: "act", profile: "large" },
			sourceProfiles: { act: "large" },
			target: { mode: "act", profile: "small", contextWindow: 128_000 },
			targetModes: ["act"],
		},
		sourceScope: {
			mode: "act",
			profile: "large",
			providerId: "p",
			modelId: "m",
			contextWindow: 1_000_000,
			fingerprint: "source",
		},
		targetScope: {
			mode: "act",
			profile: "small",
			providerId: "p",
			modelId: "m",
			contextWindow: 128_000,
			fingerprint: "target",
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

type TestRecoveryPorts = ContextCompactionRecoveryPorts & {
	applyIndicator: ReturnType<typeof vi.fn>
	restoreUiHistory: ReturnType<typeof vi.fn>
}

function ports(): TestRecoveryPorts {
	return {
		overwriteCanonicalHistory: vi.fn(async () => undefined),
		setDeletedRange: vi.fn(),
		restoreRuntime: vi.fn(),
		restoreUiHistory: vi.fn(async () => undefined),
		setOrdinaryInput: vi.fn(),
		setManualState: vi.fn(),
		setOneShotState: vi.fn(),
		setFittingState: vi.fn(),
		applyIndicator: vi.fn(async () => undefined),
		settleIndicator: vi.fn(async () => undefined),
		restoreTransition: vi.fn(async () => undefined),
		markPostCompactionRefresh: vi.fn(),
		flush: vi.fn(async () => undefined),
	}
}

describe("ContextCompactionRecoveryAdapter", () => {
	it("commits only the canonical commit view and does not duplicate protected continuation", async () => {
		const target = ports()
		const adapter = new ContextCompactionRecoveryAdapter(target)
		const checkpoint = payload("pass")
		const context: CompactionCommitContext = {
			journalId: "commit-1",
			checkpointId: head().headCheckpointId,
			checkpointHead: head(),
			requiresAdoption: false,
		}

		await adapter.applyCanonical(checkpoint, context)

		expect(target.overwriteCanonicalHistory).toHaveBeenCalledWith(checkpoint.canonicalCommitHistory)
		expect(target.overwriteCanonicalHistory).not.toHaveBeenCalledWith(checkpoint.materializedHistory)
		expect(target.setDeletedRange).toHaveBeenCalledWith(undefined)
		expect(target.applyIndicator).toHaveBeenCalledWith(checkpoint.indicator, {
			kind: "commit",
			context,
			scope: checkpoint.targetScope,
		})
		expect(target.settleIndicator).toHaveBeenCalledOnce()
		expect(target.restoreRuntime).not.toHaveBeenCalled()
		expect(target.flush).toHaveBeenCalledOnce()
	})

	it("restores checkpoint state without rewriting canonical history before final commit", async () => {
		const target = ports()
		const adapter = new ContextCompactionRecoveryAdapter(target)
		const checkpoint = payload("pass")
		const nextHead = head()
		const context: CompactionRestoreContext = {
			journalId: "restore-1",
			sourceHead: head({ headCheckpointId: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }),
			targetCheckpointId: nextHead.headCheckpointId,
			nextHead,
			canonicalRestoreRequired: false,
			completionPhase: "pass_staged",
		}

		await adapter.applyRestore(checkpoint, context)

		expect(target.overwriteCanonicalHistory).not.toHaveBeenCalled()
		expect(target.restoreRuntime).toHaveBeenCalledWith(checkpoint.runtimeSnapshot)
		expect(target.setOrdinaryInput).toHaveBeenCalledWith(checkpoint.ordinaryInput)
		expect(target.setManualState).toHaveBeenCalledWith(checkpoint.manualState)
		expect(target.setOneShotState).toHaveBeenCalledWith(checkpoint.oneShotState)
		expect(target.setFittingState).toHaveBeenCalledWith(checkpoint.fittingState, nextHead, false)
		expect(target.applyIndicator).toHaveBeenCalledWith(checkpoint.indicator, {
			kind: "restore",
			context,
			scope: checkpoint.targetScope,
		})
		expect(target.restoreTransition).toHaveBeenCalledWith(checkpoint.transition, "source")
		expect(target.settleIndicator).toHaveBeenCalledOnce()
	})

	it("reopens a committed Pass on the canonical baseline without admitting protected continuation", async () => {
		const target = ports()
		const adapter = new ContextCompactionRecoveryAdapter(target)
		const checkpoint = payload("pass")
		const nextHead = head({ branchId: "branch-restored", chainRevision: 4, sequence: 4 })
		const context: CompactionRestoreContext = {
			journalId: "restore-pass-after-commit",
			sourceHead: head(),
			targetCheckpointId: nextHead.headCheckpointId,
			nextHead,
			canonicalRestoreRequired: true,
			completionPhase: "pass_staged",
		}

		await adapter.applyRestore(checkpoint, context)

		expect(target.overwriteCanonicalHistory).toHaveBeenCalledWith(checkpoint.canonicalHistory)
		expect(target.overwriteCanonicalHistory).not.toHaveBeenCalledWith(checkpoint.materializedHistory)
		expect(target.overwriteCanonicalHistory).not.toHaveBeenCalledWith(checkpoint.canonicalCommitHistory)
		expect(target.setDeletedRange).toHaveBeenCalledWith(checkpoint.conversationHistoryDeletedRange)
		expect(target.setFittingState).toHaveBeenCalledWith(checkpoint.fittingState, nextHead, false)
		expect(target.restoreTransition).toHaveBeenCalledWith(checkpoint.transition, "source")
	})

	it("rewrites canonical state and restores source transition when a committed operation returns to C0", async () => {
		const target = ports()
		const adapter = new ContextCompactionRecoveryAdapter(target)
		const checkpoint = payload("root")
		checkpoint.uiMessageBoundary = { count: 9, lastMessageTs: 900 }
		const nextHead = head({ headCheckpointId: head().rootCheckpointId, depth: 0 })
		const context: CompactionRestoreContext = {
			journalId: "restore-2",
			sourceHead: head(),
			targetCheckpointId: nextHead.headCheckpointId,
			nextHead,
			canonicalRestoreRequired: true,
			completionPhase: "prepared",
		}

		await adapter.applyRestore(checkpoint, context)

		expect(target.restoreUiHistory).toHaveBeenCalledWith(checkpoint.uiMessageBoundary)
		expect(target.overwriteCanonicalHistory).toHaveBeenCalledWith(checkpoint.canonicalHistory)
		expect(target.setDeletedRange).toHaveBeenCalledWith([1, 2])
		expect(target.setFittingState).toHaveBeenCalledWith(checkpoint.fittingState, nextHead, false)
		expect(target.restoreTransition).toHaveBeenCalledWith(checkpoint.transition, "source")
		expect(target.flush).toHaveBeenCalledOnce()
	})
})
