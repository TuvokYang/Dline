import type { ClineMessage } from "@shared/ExtensionMessage"
import { BlockPhase } from "../BlockPhaseMachine"
import { TaskPhase } from "../TaskPhase"
import { hydrateSnapshot, type TaskSnapshot, TaskSnapshotIdentityError } from "../TaskSnapshot"
import type { ResumeDiagnostic, ResumeInput, ResumeResult } from "./ResumeInput"
import { selectAwaitingResumeEntry } from "./ResumeReducer"

interface TailFacts {
	presentedAsk?: ClineMessage
	feedback?: ClineMessage
	interactionConsumed: boolean
	latestApiIndex: number
	answeredDlineTids: Set<string>
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

/** Extract only facts after the snapshot anchors. */
function extractFacts(snapshot: TaskSnapshot, input: ResumeInput): TailFacts {
	const interaction = snapshot.interaction
	const anchorTs = interaction?.anchor?.messageTs ?? snapshot.anchor?.uiMessageTs ?? snapshot.timestamp
	const uiTail = input.uiTail.filter((message) => message.ts > anchorTs)
	const presentedAsk =
		interaction?.status === "opening"
			? input.uiTail.find(
					(message) =>
						message.type === "ask" &&
						message.ts >= snapshot.timestamp &&
						(message.conversationHistoryIndex ?? snapshot.apiIndex) >= snapshot.apiIndex,
				)
			: undefined
	const laterApi = uiTail.filter((message) => message.say === "api_req_started")
	const latestPersistedApiIndex = input.apiTail.length > 0 ? input.apiHistoryLength - 1 : snapshot.apiIndex
	const latestApiIndex = laterApi.reduce(
		(maximum, message) => Math.max(maximum, message.conversationHistoryIndex ?? snapshot.apiIndex),
		latestPersistedApiIndex,
	)
	const feedback = uiTail.find((message) => message.say === "user_feedback")
	const interactionConsumed =
		interaction?.status === "awaiting" && (feedback !== undefined || latestApiIndex > snapshot.apiIndex)

	const answeredDlineTids = new Set<string>()
	for (const message of input.apiTail) {
		if (message.role !== "user" || !Array.isArray(message.content)) continue
		for (const block of message.content) {
			if (block.type === "tool_result" && typeof block.dline_tid === "string" && block.dline_tid) {
				answeredDlineTids.add(block.dline_tid)
			}
		}
	}
	return { presentedAsk, feedback, interactionConsumed, latestApiIndex, answeredDlineTids }
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

	const facts = extractFacts(next, input)
	if (next.interaction?.status === "opening") {
		if (!facts.presentedAsk) {
			return {
				snapshot: next,
				entry: { type: "read_only_failure" },
				diagnostics: [{ code: "missing_interaction_anchor", interactionId: next.interaction.interactionId }],
			}
		}
		next.interaction = {
			...next.interaction,
			status: "awaiting",
			anchor: { messageTs: facts.presentedAsk.ts, messageType: "ask" },
		}
		next.anchor = { ...next.anchor, uiMessageTs: facts.presentedAsk.ts }
		const factsAfterPresentation = extractFacts(next, input)
		if (!factsAfterPresentation.interactionConsumed) {
			return { snapshot: next, entry: selectAwaitingResumeEntry(next), diagnostics: [] }
		}
		Object.assign(facts, factsAfterPresentation)
	}

	if (facts.interactionConsumed) {
		const consumedKind = next.interaction?.kind
		next.interaction = undefined
		next.anchor = { ...next.anchor, apiIndex: facts.latestApiIndex, interactionId: undefined }
		if (consumedKind === "completion") next.completion = undefined
		next.phase = TaskPhase.STREAMING
		next.apiIndex = facts.latestApiIndex
		const draft =
			facts.feedback && facts.latestApiIndex === input.snapshot.apiIndex
				? {
						text: facts.feedback.text ?? "",
						images: facts.feedback.images ?? [],
						files: facts.feedback.files ?? [],
					}
				: undefined
		return {
			snapshot: next,
			entry: { type: "continue_api_turn", apiIndex: facts.latestApiIndex, ...(draft ? { draft } : {}) },
			diagnostics: [],
		}
	}

	if (next.interaction?.status === "awaiting") {
		return { snapshot: next, entry: selectAwaitingResumeEntry(next), diagnostics: [] }
	}

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
