import { BlockPhase } from "../BlockPhaseMachine"
import { TaskPhase } from "../TaskPhase"
import { hydrateSnapshot, type TaskSnapshot, TaskSnapshotIdentityError } from "../TaskSnapshot"
import type { ResumeDiagnostic, ResumeInput, ResumeResult } from "./ResumeInput"
import { selectAwaitingResumeEntry } from "./ResumeReducer"

interface TailFacts {
	answeredDlineTids: Set<string>
}

/** Repair snapshots written with history.length instead of the assistant message index. */
function reconcileAssistantApiIndex(snapshot: TaskSnapshot, input: ResumeInput): void {
	const turn = snapshot.turn
	if (!turn || !snapshot.anchor) return

	const turnDlineTids = new Set(turn.blocks.map((block) => block.dlineTid))
	const tailOffset = input.apiTail.findIndex((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) return false
		const messageDlineTids = new Set(
			message.content
				.filter((block) => block.type === "tool_use" && typeof block.dline_tid === "string")
				.map((block) => block.dline_tid as string),
		)
		return turnDlineTids.size > 0 && [...turnDlineTids].every((dlineTid) => messageDlineTids.has(dlineTid))
	})
	if (tailOffset >= 0) {
		turn.assistantApiIndex = snapshot.anchor.apiIndex + 1 + tailOffset
	}
}

/** Clone a strict snapshot through its canonical hydration boundary. */
function cloneSnapshot(snapshot: TaskSnapshot): TaskSnapshot {
	const state = hydrateSnapshot(snapshot)
	return {
		version: 2,
		taskId: state.taskId,
		phase: state.phase,
		apiIndex: state.anchor.apiIndex,
		timestamp: snapshot.timestamp,
		revision: state.revision,
		anchor: { ...state.anchor },
		turn: state.turn ? { ...state.turn, blocks: state.turn.blocks.map((block) => ({ ...block })) } : undefined,
		interaction: state.interaction
			? { ...state.interaction, anchor: state.interaction.anchor ? { ...state.interaction.anchor } : undefined }
			: undefined,
		cancellation: state.cancellation ? { ...state.cancellation } : undefined,
		runtimeError: state.error ? { ...state.error } : undefined,
		completion: state.completion ? { ...state.completion } : undefined,
	}
}

/** Extract persisted facts that carry their own canonical identity. */
function extractFacts(input: ResumeInput): TailFacts {
	const answeredDlineTids = new Set<string>()
	for (const message of input.apiTail) {
		if (message.role !== "user" || !Array.isArray(message.content)) continue
		for (const block of message.content) {
			if (block.type === "tool_result" && typeof block.dline_tid === "string" && block.dline_tid) {
				answeredDlineTids.add(block.dline_tid)
			}
		}
	}
	return { answeredDlineTids }
}

/** Reconcile a strict snapshot with only its persisted UI/API tail. */
export function reconcileResume(input: ResumeInput): ResumeResult {
	let next: TaskSnapshot
	try {
		next = cloneSnapshot(input.snapshot)
	} catch (error) {
		const diagnostic: ResumeDiagnostic =
			error instanceof TaskSnapshotIdentityError
				? { code: "missing_identity", field: error.field }
				: { code: "invalid_snapshot_version" }
		return { snapshot: input.snapshot, entry: { type: "read_only_failure" }, diagnostics: [diagnostic] }
	}
	if (next.taskId !== input.taskId) {
		return {
			snapshot: next,
			entry: { type: "read_only_failure" },
			diagnostics: [{ code: "task_mismatch", expected: input.taskId, actual: next.taskId }],
		}
	}
	if (
		!next.anchor ||
		next.anchor.apiIndex < -1 ||
		!Number.isInteger(next.anchor.apiIndex) ||
		next.anchor.apiIndex >= input.apiHistoryLength
	) {
		return {
			snapshot: next,
			entry: { type: "read_only_failure" },
			diagnostics: [{ code: "corrupt_anchor", field: "apiIndex" }],
		}
	}
	if (next.anchor.uiMessageTs !== undefined && (!Number.isInteger(next.anchor.uiMessageTs) || next.anchor.uiMessageTs < 0)) {
		return {
			snapshot: next,
			entry: { type: "read_only_failure" },
			diagnostics: [{ code: "corrupt_anchor", field: "uiMessageTs" }],
		}
	}

	const facts = extractFacts(input)
	if (next.interaction?.status === "opening") {
		return {
			snapshot: next,
			entry: { type: "read_only_failure" },
			diagnostics: [{ code: "missing_interaction_anchor", interactionId: next.interaction.interactionId }],
		}
	}

	if (next.interaction?.status === "awaiting" || next.interaction?.status === "resolving") {
		return { snapshot: next, entry: selectAwaitingResumeEntry(next), diagnostics: [] }
	}

	reconcileAssistantApiIndex(next, input)

	if (next.phase === TaskPhase.CANCELLING || next.phase === TaskPhase.PAUSED) {
		next.phase = TaskPhase.PAUSED
		next.cancellation = undefined
		return { snapshot: next, entry: { type: "show_resume_interaction" }, diagnostics: [] }
	}

	if (next.turn) {
		const knownTurnTids = new Set(next.turn.blocks.map((block) => block.dlineTid))
		for (const block of next.turn.blocks) {
			if (facts.answeredDlineTids.has(block.dlineTid)) block.phase = BlockPhase.COMPLETED
		}
		const pending = next.turn.blocks.filter(
			(block) =>
				block.phase !== BlockPhase.COMPLETED &&
				block.phase !== BlockPhase.REJECTED &&
				block.phase !== BlockPhase.SKIPPED &&
				block.phase !== BlockPhase.CANCELLED,
		)
		const unmatched = [...facts.answeredDlineTids].filter((dlineTid) => !knownTurnTids.has(dlineTid))
		if (unmatched.length > 0) {
			const [dlineTid] = unmatched
			return {
				snapshot: next,
				entry: { type: "read_only_failure" },
				diagnostics: [{ code: "unmatched_tool_result", dlineTid }],
			}
		}
		if (pending.length > 0) {
			return {
				snapshot: next,
				entry: {
					type: "replay_pending_blocks",
					turnId: next.turn.turnId,
					dlineTids: pending.map((block) => block.dlineTid),
					answeredDlineTids: [...facts.answeredDlineTids],
				},
				diagnostics: [],
			}
		}
	}

	return { snapshot: next, entry: { type: "continue_api_turn", apiIndex: next.anchor.apiIndex }, diagnostics: [] }
}
