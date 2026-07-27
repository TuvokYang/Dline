import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import { TaskPhase } from "../TaskPhase"
import { hydrateSnapshot, type TaskSnapshot } from "../TaskSnapshot"

export interface ResumeSnapshotBuilderInput {
	taskId: string
	uiHistory: readonly ClineMessage[]
	apiHistory: readonly ClineStorageMessage[]
}

export interface ResumeSnapshotBuilderResult {
	snapshot: TaskSnapshot
	apiTailStartIndex: number
}

function isUsableEmbeddedSnapshot(snapshot: TaskSnapshot, taskId: string, apiHistoryLength: number): boolean {
	try {
		const state = hydrateSnapshot(snapshot)
		return (
			state.taskId === taskId &&
			Number.isInteger(state.anchor.apiIndex) &&
			state.anchor.apiIndex >= -1 &&
			state.anchor.apiIndex < apiHistoryLength
		)
	} catch {
		return false
	}
}

function latestEmbeddedSnapshot(input: ResumeSnapshotBuilderInput): TaskSnapshot | undefined {
	for (let index = input.uiHistory.length - 1; index >= 0; index--) {
		const message = input.uiHistory[index]
		if (message?.type !== "say" || message.say !== "state_snapshot" || !message.text) continue
		try {
			const candidate = JSON.parse(message.text) as TaskSnapshot
			if (isUsableEmbeddedSnapshot(candidate, input.taskId, input.apiHistory.length)) return candidate
		} catch {
			// A damaged historical snapshot row is skipped; older rows remain usable.
		}
	}
	return undefined
}

function latestPersistedTimestamp(input: ResumeSnapshotBuilderInput): number {
	let timestamp = 0
	for (const message of input.uiHistory) timestamp = Math.max(timestamp, message.ts)
	for (const message of input.apiHistory) timestamp = Math.max(timestamp, message.ts ?? 0)
	return timestamp
}

/**
 * Build a strict baseline without executing or inferring side effects.
 *
 * Older UI JSONL files may still contain canonical snapshot rows. When none is
 * usable, replay begins at -1 so the same tail folder processes the complete
 * API history.
 */
export function buildResumeSnapshot(input: ResumeSnapshotBuilderInput): ResumeSnapshotBuilderResult {
	const embedded = latestEmbeddedSnapshot(input)
	if (embedded) {
		return { snapshot: embedded, apiTailStartIndex: embedded.apiIndex + 1 }
	}

	return {
		snapshot: {
			version: 2,
			taskId: input.taskId,
			phase: TaskPhase.PAUSED,
			apiIndex: -1,
			timestamp: latestPersistedTimestamp(input),
			revision: 0,
			anchor: { apiIndex: -1 },
		},
		apiTailStartIndex: 0,
	}
}
