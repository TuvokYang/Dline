import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { CompactionCommitContext } from "@core/context/context-management/fitting-commit"
import type { CompactionRestoreContext } from "@core/context/context-management/fitting-restore"
import type { RecentlyModifiedFilesSnapshot } from "@core/context/context-tracking/FileContextTracker"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import type {
	ContextCompactionCheckpointPayload,
	ContextCompactionIndicatorCheckpoint,
	ContextCompactionManualState,
	ContextCompactionScopeIdentity,
	ContextCompactionUiMessageBoundary,
} from "./ContextCompactionCheckpoint"
import type { ContextCompactionTransitionState } from "./ContextCompactionSession"
import type { TaskSnapshot } from "./TaskSnapshot"
import type { TaskState } from "./TaskState"

export type ContextCompactionTransitionRestoreTarget = "source" | "target" | "none"

export type ContextCompactionIndicatorApplyContext =
	| { kind: "commit"; context: CompactionCommitContext; scope: ContextCompactionScopeIdentity }
	| { kind: "restore"; context: CompactionRestoreContext; scope: ContextCompactionScopeIdentity }

export interface ContextCompactionRecoveryPorts {
	overwriteCanonicalHistory(history: ClineStorageMessage[]): Promise<void>
	setDeletedRange(range: [number, number] | undefined): void
	restoreUiHistory(boundary: ContextCompactionUiMessageBoundary): Promise<void>
	restoreRuntime(snapshot: TaskSnapshot): Promise<void>
	setOrdinaryInput(content: ClineContent[]): void
	setManualState(state: ContextCompactionManualState): void
	setOneShotState(state: {
		recentlyModifiedFiles: RecentlyModifiedFilesSnapshot
		pendingRecentlyModifiedFilesSnapshot?: RecentlyModifiedFilesSnapshot
		pendingBackgroundCommandLineCounts?: Array<{ id: string; lineCount: number }>
		pendingSystemPromptRefreshReason?: string
	}): void
	setFittingState(state: TaskState["targetWindowFittingState"], head: CompactionCheckpointHead, committed: boolean): void
	applyIndicator(indicator: ContextCompactionIndicatorCheckpoint, context: ContextCompactionIndicatorApplyContext): Promise<void>
	settleIndicator(): Promise<void>
	restoreTransition(
		transition: ContextCompactionTransitionState | undefined,
		target: ContextCompactionTransitionRestoreTarget,
	): Promise<void>
	markPostCompactionRefresh(): void
	flush(): Promise<void>
}

/** Apply durable checkpoint payloads without coupling journal orchestration to Task internals. */
export class ContextCompactionRecoveryAdapter {
	constructor(private readonly ports: ContextCompactionRecoveryPorts) {}

	async applyCanonical(payload: ContextCompactionCheckpointPayload, context: CompactionCommitContext): Promise<void> {
		await this.ports.overwriteCanonicalHistory(payload.canonicalCommitHistory)
		this.ports.setDeletedRange(payload.canonicalCommitDeletedRange)
		this.ports.setFittingState(undefined, context.checkpointHead, true)
		await this.ports.applyIndicator(payload.indicator, { kind: "commit", context, scope: payload.targetScope })
		if (!context.requiresAdoption) await this.ports.settleIndicator()
		this.ports.markPostCompactionRefresh()
		await this.ports.flush()
	}

	async applyTransition(
		payload: ContextCompactionCheckpointPayload,
		target: Exclude<ContextCompactionTransitionRestoreTarget, "none">,
	): Promise<void> {
		await this.ports.restoreTransition(payload.transition, payload.transition ? target : "none")
		await this.ports.settleIndicator()
		await this.ports.flush()
	}

	async applyRestore(payload: ContextCompactionCheckpointPayload, context: CompactionRestoreContext): Promise<void> {
		if (context.canonicalRestoreRequired) {
			const canonicalHistory =
				context.completionPhase === "completed" ? payload.canonicalCommitHistory : payload.canonicalHistory
			const deletedRange =
				context.completionPhase === "completed"
					? payload.canonicalCommitDeletedRange
					: payload.conversationHistoryDeletedRange
			await this.ports.overwriteCanonicalHistory(canonicalHistory)
			this.ports.setDeletedRange(deletedRange)
		}
		if (payload.uiMessageBoundary) await this.ports.restoreUiHistory(payload.uiMessageBoundary)
		await this.ports.restoreRuntime(payload.runtimeSnapshot)
		this.ports.setOrdinaryInput(payload.ordinaryInput)
		this.ports.setManualState(payload.manualState)
		this.ports.setOneShotState(payload.oneShotState)
		const keepFittingState = context.completionPhase === "prepared" || context.completionPhase === "pass_staged"
		this.ports.setFittingState(
			keepFittingState ? payload.fittingState : undefined,
			context.nextHead,
			context.completionPhase === "completed" && payload.kind === "pass",
		)
		const indicatorScope = payload.kind === "root" ? payload.sourceScope : payload.targetScope
		await this.ports.applyIndicator(payload.indicator, { kind: "restore", context, scope: indicatorScope })
		const transitionTarget =
			context.completionPhase === "completed" ? (payload.kind === "root" ? "source" : "target") : "source"
		await this.ports.restoreTransition(payload.transition, payload.transition ? transitionTarget : "none")
		await this.ports.settleIndicator()
		await this.ports.flush()
	}
}
