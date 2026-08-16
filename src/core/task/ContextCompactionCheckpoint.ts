import type { ApiHandler } from "@core/api"
import { hashCompactionCheckpointValue } from "@core/context/context-management/compaction-checkpoint-chain"
import type { ContextWindowRequestPressure } from "@core/context/context-management/context-window-projection"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import {
	buildTargetCandidateHistory,
	type TargetWindowFittingState,
} from "@core/context/context-management/target-window-fitting"
import type { RecentlyModifiedFilesSnapshot } from "@core/context/context-tracking/FileContextTracker"
import type { ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import cloneDeep from "clone-deep"
import type { ContextCompactionTransitionState, ContextCompactionTriggerKind } from "./ContextCompactionSession"
import type { TaskSnapshot } from "./TaskSnapshot"
import type { TaskState } from "./TaskState"

export const CONTEXT_COMPACTION_CHECKPOINT_PAYLOAD_SCHEMA_VERSION = 1 as const
export const CONTEXT_COMPACTION_RECOVERY_DIRECTORY = "context-compaction-recovery"

/** Stable, non-secret identity for one source or target request scope. */
export interface ContextCompactionScopeIdentity {
	mode: Mode
	profile?: string
	providerId: string
	modelId: string
	contextWindow: number
	fingerprint: string
}

/**
 * Transitional representation of the existing single-value context indicator.
 * The raw request-pressure history is retained so CTX-004 can migrate this C0
 * to the authoritative four-segment snapshot without inventing lost usage.
 */
export interface ContextCompactionLegacyIndicatorCheckpoint {
	revision: 0
	phase: "durable"
	durableContextTokens: number
	pendingSendTokens: 0
	receivingTokens: 0
	environmentTokens: 0
	contextWindow: number
	source: "legacy_unsegmented"
	requestPressures: ContextWindowRequestPressure[]
}

/** Stable recoverable values; runtime lineage is rebound from the artifact head or restore journal. */
export interface ContextCompactionAuthoritativeIndicatorCheckpoint
	extends Omit<ContextWindowIndicatorSnapshot, "lineage" | "phase" | "pendingSendTokens" | "receivingTokens"> {
	source: "authoritative"
	phase: "stable"
	pendingSendTokens: 0
	receivingTokens: 0
}

export type ContextCompactionIndicatorCheckpoint =
	| ContextCompactionLegacyIndicatorCheckpoint
	| ContextCompactionAuthoritativeIndicatorCheckpoint

export interface ContextCompactionManualState {
	pendingManualCompactionContinuation?: TaskState["pendingManualCompactionContinuation"]
	pendingManualCompactionRegeneration?: TaskState["pendingManualCompactionRegeneration"]
	deferredCurrentTurn?: TaskState["deferredCurrentTurn"]
}

export interface ContextCompactionOneShotState {
	recentlyModifiedFiles: RecentlyModifiedFilesSnapshot
	pendingRecentlyModifiedFilesSnapshot?: RecentlyModifiedFilesSnapshot
	pendingBackgroundCommandLineCounts?: Array<{ id: string; lineCount: number }>
	pendingSystemPromptRefreshReason?: string
}

/** Durable UI timeline boundary captured before the next Pass mutates presentation state. */
export interface ContextCompactionUiMessageBoundary {
	count: number
	lastMessageTs?: number
}

/** Complete materialized Task state stored in C0 and every accepted Pass artifact. */
export interface ContextCompactionCheckpointPayload {
	schemaVersion: typeof CONTEXT_COMPACTION_CHECKPOINT_PAYLOAD_SCHEMA_VERSION
	kind: "root" | "pass"
	taskId: string
	operationId: string
	trigger: ContextCompactionTriggerKind
	canonicalHistory: ClineStorageMessage[]
	conversationHistoryDeletedRange?: [number, number]
	fittingState: TargetWindowFittingState
	materializedHistory: ClineStorageMessage[]
	materializedDeletedRange?: [number, number]
	canonicalCommitHistory: ClineStorageMessage[]
	canonicalCommitDeletedRange?: [number, number]
	/** Complete assistant/tool tail that must survive the final canonical commit. */
	protectedHistory?: ClineStorageMessage[]
	protectedContinuation: ClineContent[]
	passGuidance: ClineContent[]
	ordinaryInput: ClineContent[]
	/** Optional only for backward compatibility with artifacts created before UI-boundary persistence. */
	uiMessageBoundary?: ContextCompactionUiMessageBoundary
	runtimeSnapshot: TaskSnapshot
	manualState: ContextCompactionManualState
	oneShotState: ContextCompactionOneShotState
	transition?: ContextCompactionTransitionState
	sourceScope: ContextCompactionScopeIdentity
	targetScope: ContextCompactionScopeIdentity
	indicator: ContextCompactionIndicatorCheckpoint
}

export interface CreateContextCompactionCheckpointPayloadInput {
	kind: "root" | "pass"
	taskId: string
	operationId: string
	trigger: ContextCompactionTriggerKind
	canonicalHistory: readonly ClineStorageMessage[]
	conversationHistoryDeletedRange?: [number, number]
	fittingState: TargetWindowFittingState
	protectedHistory?: readonly ClineStorageMessage[]
	protectedContinuation: readonly ClineContent[]
	passGuidance?: readonly ClineContent[]
	ordinaryInput: readonly ClineContent[]
	uiMessageBoundary: ContextCompactionUiMessageBoundary
	runtimeSnapshot: TaskSnapshot
	manualState: ContextCompactionManualState
	oneShotState: ContextCompactionOneShotState
	transition?: ContextCompactionTransitionState
	sourceScope: ContextCompactionScopeIdentity
	targetScope: ContextCompactionScopeIdentity
	indicator: ContextCompactionIndicatorCheckpoint
}

/** Clone one complete checkpoint payload so no runtime-owned value can mutate its identity after hashing. */
export function createContextCompactionCheckpointPayload(
	input: CreateContextCompactionCheckpointPayloadInput,
): ContextCompactionCheckpointPayload {
	const canonicalHistory: ClineStorageMessage[] = cloneDeep([...input.canonicalHistory])
	const protectedHistory: ClineStorageMessage[] = cloneDeep([...(input.protectedHistory ?? [])])
	const protectedContinuation: ClineContent[] = cloneDeep([...input.protectedContinuation])
	const passGuidance: ClineContent[] = cloneDeep([...(input.passGuidance ?? [])])
	const ordinaryInput: ClineContent[] = cloneDeep([...input.ordinaryInput])
	const materializedContinuation: ClineStorageMessage[] = [
		...protectedHistory,
		...(protectedContinuation.length ? [{ role: "user" as const, content: protectedContinuation }] : []),
	]
	return {
		schemaVersion: CONTEXT_COMPACTION_CHECKPOINT_PAYLOAD_SCHEMA_VERSION,
		kind: input.kind,
		taskId: input.taskId,
		operationId: input.operationId,
		trigger: input.trigger,
		canonicalHistory,
		conversationHistoryDeletedRange: input.conversationHistoryDeletedRange
			? [...input.conversationHistoryDeletedRange]
			: undefined,
		fittingState: cloneDeep(input.fittingState),
		materializedHistory:
			input.kind === "root"
				? cloneDeep(canonicalHistory)
				: buildTargetCandidateHistory(input.fittingState, materializedContinuation),
		materializedDeletedRange:
			input.kind === "root" && input.conversationHistoryDeletedRange
				? [...input.conversationHistoryDeletedRange]
				: undefined,
		canonicalCommitHistory:
			input.kind === "root"
				? cloneDeep(canonicalHistory)
				: buildTargetCandidateHistory(input.fittingState, protectedHistory),
		canonicalCommitDeletedRange:
			input.kind === "root" && input.conversationHistoryDeletedRange
				? [...input.conversationHistoryDeletedRange]
				: undefined,
		protectedHistory,
		protectedContinuation,
		passGuidance,
		ordinaryInput,
		uiMessageBoundary: cloneDeep(input.uiMessageBoundary),
		runtimeSnapshot: cloneDeep(input.runtimeSnapshot),
		manualState: cloneDeep(input.manualState),
		oneShotState: cloneDeep(input.oneShotState),
		transition: cloneDeep(input.transition),
		sourceScope: cloneDeep(input.sourceScope),
		targetScope: cloneDeep(input.targetScope),
		indicator: cloneDeep(input.indicator),
	}
}

/** Build a stable request-scope identity without serializing a live handler or credentials. */
export function createContextCompactionScopeIdentity(
	api: ApiHandler,
	mode: Mode,
	profile?: string,
): ContextCompactionScopeIdentity {
	const model = api.getModel()
	const providerId = api.getProviderId?.() ?? "unknown"
	const { contextWindow } = getContextWindowInfo(api)
	const identity = {
		mode,
		profile,
		providerId,
		modelId: model.id,
		contextWindow,
	}
	return {
		...identity,
		fingerprint: hashCompactionCheckpointValue(identity),
	}
}

/** Preserve the last reliable durable usage while retaining every raw pressure input for later migration. */
export function createLegacyIndicatorCheckpoint(
	requestPressures: readonly ContextWindowRequestPressure[],
	contextWindow: number,
): ContextCompactionLegacyIndicatorCheckpoint {
	const durableContextTokens = [...requestPressures]
		.reverse()
		.find((pressure) => typeof pressure.contextTokens === "number" && pressure.contextTokens > 0)?.contextTokens
	return {
		revision: 0,
		phase: "durable",
		durableContextTokens: durableContextTokens ?? 0,
		pendingSendTokens: 0,
		receivingTokens: 0,
		environmentTokens: 0,
		contextWindow,
		source: "legacy_unsegmented",
		requestPressures: cloneDeep([...requestPressures]),
	}
}

/** Freeze the Task-owned snapshot before hashing it into a checkpoint artifact. */
export function createAuthoritativeIndicatorCheckpoint(
	snapshot: ContextWindowIndicatorSnapshot,
): ContextCompactionAuthoritativeIndicatorCheckpoint {
	const { lineage: _lineage, ...durable } = cloneDeep(snapshot)
	return {
		...durable,
		phase: "stable",
		durableContextTokens: durable.durableContextTokens + durable.pendingSendTokens,
		pendingSendTokens: 0,
		receivingTokens: 0,
		source: "authoritative",
	}
}
