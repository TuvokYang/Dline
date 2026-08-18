import type { ContextWindowIndicatorLineage, ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import type { Mode } from "@shared/storage/types"

export interface CreateContextWindowIndicatorInput {
	taskId: string
	durableContextTokens: number
	environmentTokens: number
	contextWindow: number
	profileId?: string
	profileName?: string
	mode: Mode
	lineage?: ContextWindowIndicatorLineage
	updatedAt?: number
}

export interface BeginContextWindowIndicatorSendInput {
	lineage: ContextWindowIndicatorLineage
	durableContextTokens: number
	pendingSendTokens: number
	environmentTokens: number
	contextWindow: number
	profileId?: string
	profileName?: string
	mode: Mode
	updatedAt?: number
}

export interface ReceiveContextWindowIndicatorInput {
	lineage: ContextWindowIndicatorLineage
	receivingTokens: number
	/** Provider-reported total context for the in-flight request, including output and cache tokens. */
	authoritativeContextTokens?: number
	updatedAt?: number
}

export interface CommitContextWindowIndicatorInput {
	lineage: ContextWindowIndicatorLineage
	nextLineage?: ContextWindowIndicatorLineage
	durableContextTokens: number
	pendingSendTokens?: number
	environmentTokens: number
	contextWindow?: number
	profileId?: string
	profileName?: string
	mode?: Mode
	updatedAt?: number
}

export interface RollbackContextWindowIndicatorInput {
	lineage: ContextWindowIndicatorLineage
	updatedAt?: number
}

export interface RestoreContextWindowIndicatorInput {
	lineage: ContextWindowIndicatorLineage
	durableContextTokens: number
	pendingSendTokens?: number
	environmentTokens: number
	contextWindow: number
	profileId?: string
	profileName?: string
	mode: Mode
	updatedAt?: number
}

export type RecoverCommitContextWindowIndicatorInput = RestoreContextWindowIndicatorInput

export interface SettleContextWindowIndicatorInput {
	lineage: ContextWindowIndicatorLineage
	updatedAt?: number
}

export interface FoldContextWindowIndicatorRoundInput {
	lineage: ContextWindowIndicatorLineage
	/** Provider-reported total context for the completed request, including output and cache tokens. */
	authoritativeContextTokens?: number
	updatedAt?: number
}

export interface AdoptContextWindowIndicatorScopeInput {
	contextWindow: number
	profileId?: string
	profileName?: string
	mode: Mode
	updatedAt?: number
}

export interface RefreshStableContextWindowIndicatorInput extends AdoptContextWindowIndicatorScopeInput {
	environmentTokens: number
}

/** Own the only mutable context-window snapshot for one Task. */
export class ContextWindowIndicator {
	private current: ContextWindowIndicatorSnapshot
	private durableBaseline: ContextWindowIndicatorSnapshot

	constructor(input: CreateContextWindowIndicatorInput) {
		this.current = {
			taskId: input.taskId,
			revision: 0,
			epoch: 0,
			phase: "stable",
			durableContextTokens: normalizeTokens(input.durableContextTokens),
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: normalizeTokens(input.environmentTokens),
			contextWindow: normalizeTokens(input.contextWindow),
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: input.updatedAt ?? Date.now(),
			lineage: input.lineage ?? { kind: "baseline" },
		}
		this.durableBaseline = cloneSnapshot(this.current)
	}

	getSnapshot(): ContextWindowIndicatorSnapshot {
		return cloneSnapshot(this.current)
	}

	/** Adopt a committed runtime scope without changing token or lineage state. */
	adoptScope(input: AdoptContextWindowIndicatorScopeInput): ContextWindowIndicatorSnapshot {
		const contextWindow = normalizeTokens(input.contextWindow)
		if (
			this.current.contextWindow === contextWindow &&
			this.current.profileId === input.profileId &&
			this.current.profileName === input.profileName &&
			this.current.mode === input.mode
		) {
			return this.getSnapshot()
		}

		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			epoch: this.current.epoch + 1,
			contextWindow,
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: input.updatedAt ?? Date.now(),
		}
		this.durableBaseline = {
			...this.durableBaseline,
			contextWindow,
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: this.current.updatedAt,
		}
		return this.getSnapshot()
	}

	/** Refresh dynamic environment occupancy and Provider scope without disturbing an active request lineage. */
	refreshStable(input: RefreshStableContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		if (this.current.phase !== "stable") return this.getSnapshot()
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			environmentTokens: normalizeTokens(input.environmentTokens),
			contextWindow: normalizeTokens(input.contextWindow),
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: input.updatedAt ?? Date.now(),
		}
		this.durableBaseline = cloneSnapshot(this.current)
		return this.getSnapshot()
	}

	beginSend(input: BeginContextWindowIndicatorSendInput): ContextWindowIndicatorSnapshot {
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			epoch: this.current.epoch + 1,
			phase: "sending",
			durableContextTokens: normalizeTokens(input.durableContextTokens),
			pendingSendTokens: normalizeTokens(input.pendingSendTokens),
			receivingTokens: 0,
			environmentTokens: normalizeTokens(input.environmentTokens),
			contextWindow: normalizeTokens(input.contextWindow),
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: input.updatedAt ?? Date.now(),
			lineage: cloneLineage(input.lineage),
		}
		return this.getSnapshot()
	}

	receive(input: ReceiveContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		const receivingTokens = normalizeTokens(input.receivingTokens)
		const authoritativeContextTokens = normalizeTokens(input.authoritativeContextTokens ?? 0)
		if (
			!isSameContextWindowIndicatorLineage(this.current.lineage, input.lineage) ||
			(this.current.phase !== "sending" && this.current.phase !== "receiving") ||
			(authoritativeContextTokens <= 0 && receivingTokens <= this.current.receivingTokens)
		) {
			return this.getSnapshot()
		}
		const availableInputTokens = Math.max(
			0,
			authoritativeContextTokens - Math.min(this.current.environmentTokens, authoritativeContextTokens) - receivingTokens,
		)
		const environmentTokens =
			authoritativeContextTokens > 0
				? Math.min(this.current.environmentTokens, Math.max(0, authoritativeContextTokens - receivingTokens))
				: this.current.environmentTokens
		const durableContextTokens =
			authoritativeContextTokens > 0
				? Math.min(this.current.durableContextTokens, availableInputTokens)
				: this.current.durableContextTokens
		const pendingSendTokens =
			authoritativeContextTokens > 0
				? Math.max(0, authoritativeContextTokens - environmentTokens - receivingTokens - durableContextTokens)
				: this.current.pendingSendTokens
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			phase: "receiving",
			durableContextTokens,
			pendingSendTokens,
			receivingTokens,
			environmentTokens,
			updatedAt: input.updatedAt ?? Date.now(),
		}
		return this.getSnapshot()
	}

	commit(input: CommitContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		if (!isSameContextWindowIndicatorLineage(this.current.lineage, input.lineage)) return this.getSnapshot()
		const lineage = cloneLineage(input.nextLineage ?? input.lineage)
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			phase: "committing",
			durableContextTokens: mergeDurableTokens(input.durableContextTokens, input.pendingSendTokens),
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: normalizeTokens(input.environmentTokens),
			contextWindow: normalizeTokens(input.contextWindow ?? this.current.contextWindow),
			profileId: input.profileId ?? this.current.profileId,
			profileName: input.profileName ?? this.current.profileName,
			mode: input.mode ?? this.current.mode,
			updatedAt: input.updatedAt ?? Date.now(),
			lineage,
		}
		this.durableBaseline = { ...cloneSnapshot(this.current), phase: "stable" }
		return this.getSnapshot()
	}

	rollback(input: RollbackContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		if (!isSameContextWindowIndicatorLineage(this.current.lineage, input.lineage)) return this.getSnapshot()
		this.current = {
			...cloneSnapshot(this.durableBaseline),
			revision: this.current.revision + 1,
			epoch: this.current.epoch + 1,
			phase: "rolling_back",
			updatedAt: input.updatedAt ?? Date.now(),
		}
		return this.getSnapshot()
	}

	recoverCommit(input: RecoverCommitContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		return this.replaceDurable(input, "committing")
	}

	restore(input: RestoreContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		return this.replaceDurable(input, "restoring")
	}

	private replaceDurable(
		input: RestoreContextWindowIndicatorInput,
		phase: "committing" | "restoring",
	): ContextWindowIndicatorSnapshot {
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			epoch: this.current.epoch + 1,
			phase,
			durableContextTokens: mergeDurableTokens(input.durableContextTokens, input.pendingSendTokens),
			pendingSendTokens: 0,
			receivingTokens: 0,
			environmentTokens: normalizeTokens(input.environmentTokens),
			contextWindow: normalizeTokens(input.contextWindow),
			profileId: input.profileId,
			profileName: input.profileName,
			mode: input.mode,
			updatedAt: input.updatedAt ?? Date.now(),
			lineage: cloneLineage(input.lineage),
		}
		this.durableBaseline = { ...cloneSnapshot(this.current), phase: "stable" }
		return this.getSnapshot()
	}

	/** Fold a fully completed round (including tool calls) into durable; ENV is never folded. */
	foldRound(input: FoldContextWindowIndicatorRoundInput): ContextWindowIndicatorSnapshot {
		if (!isSameContextWindowIndicatorLineage(this.current.lineage, input.lineage)) return this.getSnapshot()
		if (this.current.pendingSendTokens <= 0 && this.current.receivingTokens <= 0) return this.getSnapshot()
		const authoritativeContextTokens = normalizeTokens(input.authoritativeContextTokens ?? 0)
		const durableContextTokens =
			authoritativeContextTokens > 0
				? Math.max(0, authoritativeContextTokens - this.current.environmentTokens)
				: this.current.durableContextTokens + this.current.pendingSendTokens + this.current.receivingTokens
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			epoch: this.current.epoch + 1,
			phase: "committing",
			durableContextTokens,
			pendingSendTokens: 0,
			receivingTokens: 0,
			updatedAt: input.updatedAt ?? Date.now(),
		}
		this.durableBaseline = { ...cloneSnapshot(this.current), phase: "stable" }
		return this.getSnapshot()
	}

	settle(input: SettleContextWindowIndicatorInput): ContextWindowIndicatorSnapshot {
		if (!isSameContextWindowIndicatorLineage(this.current.lineage, input.lineage) || this.current.phase === "stable") {
			return this.getSnapshot()
		}
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			phase: "stable",
			updatedAt: input.updatedAt ?? Date.now(),
		}
		this.durableBaseline = cloneSnapshot(this.current)
		return this.getSnapshot()
	}
}

export function isSameContextWindowIndicatorLineage(
	left: ContextWindowIndicatorLineage,
	right: ContextWindowIndicatorLineage,
): boolean {
	if (left.kind !== right.kind) return false
	switch (left.kind) {
		case "baseline":
			return (
				right.kind === "baseline" &&
				left.checkpointId === right.checkpointId &&
				left.chainRevision === right.chainRevision &&
				left.branchId === right.branchId
			)
		case "ordinary":
			return (
				right.kind === "ordinary" &&
				left.requestId === right.requestId &&
				left.requestSequence === right.requestSequence &&
				left.attemptId === right.attemptId
			)
		case "compaction_pass":
			return (
				right.kind === "compaction_pass" &&
				left.operationId === right.operationId &&
				left.passIndex === right.passIndex &&
				left.attemptIndex === right.attemptIndex &&
				left.attemptId === right.attemptId &&
				left.headCheckpointId === right.headCheckpointId &&
				left.chainRevision === right.chainRevision &&
				left.branchId === right.branchId
			)
		case "checkpoint":
			return (
				right.kind === "checkpoint" &&
				left.operationId === right.operationId &&
				left.checkpointId === right.checkpointId &&
				left.chainRevision === right.chainRevision &&
				left.branchId === right.branchId
			)
		case "restore":
			return (
				right.kind === "restore" &&
				left.operationId === right.operationId &&
				left.journalId === right.journalId &&
				left.targetCheckpointId === right.targetCheckpointId &&
				left.headCheckpointId === right.headCheckpointId &&
				left.chainRevision === right.chainRevision &&
				left.branchId === right.branchId
			)
	}
}

function cloneSnapshot(snapshot: ContextWindowIndicatorSnapshot): ContextWindowIndicatorSnapshot {
	return { ...snapshot, lineage: cloneLineage(snapshot.lineage) }
}

function cloneLineage(lineage: ContextWindowIndicatorLineage): ContextWindowIndicatorLineage {
	return { ...lineage }
}

function mergeDurableTokens(durableContextTokens: number, pendingSendTokens?: number): number {
	return normalizeTokens(durableContextTokens) + normalizeTokens(pendingSendTokens ?? 0)
}

function normalizeTokens(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
