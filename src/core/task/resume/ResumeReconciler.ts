import type { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import { BlockPhase } from "../BlockPhaseMachine"
import type { InteractionKind } from "../interaction/Interaction"
import { getInteraction } from "../interaction/InteractionRegistry"
import { TaskPhase } from "../TaskPhase"
import { hydrateSnapshot, type TaskSnapshot } from "../TaskSnapshot"
import type { ResumeDiagnostic, ResumeEntry, ResumeInput, ResumeResult } from "./ResumeInput"
import { selectResumeUiTail } from "./ResumeInput"
import { selectAwaitingResumeEntry } from "./ResumeReducer"
import { buildResumeSnapshot } from "./ResumeSnapshotBuilder"
import { foldResumeTail } from "./ResumeTailFold"

const ASK_INTERACTIONS: Partial<Record<ClineAsk, InteractionKind>> = {
	tool: "tool_approval",
	command: "command_approval",
	browser_action_launch: "browser_approval",
	use_mcp_server: "mcp_approval",
	use_subagents: "subagent_approval",
	spawn_task: "spawn_task_approval",
	focus_chain_change: "focus_chain_change",
	new_task: "new_task",
	report_bug: "report_bug",
	condense: "condense",
	followup: "followup",
	plan_mode_respond: "plan_response",
	qna_respond: "qna_response",
	generate_report: "generate_report",
	status_acknowledgment: "status_acknowledgment",
	api_req_failed: "error_retry",
	mistake_limit_reached: "mistake_limit",
	completion_result: "completion",
	resume_completed_task: "completion",
	resume_task: "resume",
}

const TERMINAL_BLOCK_PHASES = new Set([BlockPhase.COMPLETED, BlockPhase.REJECTED, BlockPhase.SKIPPED, BlockPhase.CANCELLED])

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

function isValidAnchor(snapshot: TaskSnapshot, historyLength: number): boolean {
	const index = snapshot.anchor?.apiIndex
	return (
		index !== undefined &&
		Number.isInteger(index) &&
		index >= -1 &&
		index < historyLength &&
		(snapshot.anchor?.uiMessageTs === undefined ||
			(Number.isInteger(snapshot.anchor.uiMessageTs) && snapshot.anchor.uiMessageTs >= 0))
	)
}

type SnapshotRebuildReason = Extract<ResumeDiagnostic, { code: "snapshot_rebuilt" }>["reason"]

function rebuildReason(error: unknown, snapshot: TaskSnapshot | undefined, taskId: string): SnapshotRebuildReason {
	if (!snapshot) return "missing"
	if (snapshot.taskId !== taskId) return "task_mismatch"
	if (error instanceof Error && error.message === "corrupt_anchor") return "corrupt_anchor"
	return "invalid"
}

interface PreparedResumeInput {
	snapshot: TaskSnapshot
	apiTail: readonly ClineStorageMessage[]
	uiTail: readonly ClineMessage[]
	apiTailStartIndex: number
	diagnostics: ResumeDiagnostic[]
}

function prepareInput(input: ResumeInput): PreparedResumeInput {
	const fullUiHistory = input.uiHistory ?? input.uiTail
	try {
		if (!input.snapshot) throw new Error("snapshot_missing")
		const snapshot = cloneSnapshot(input.snapshot)
		if (snapshot.taskId !== input.taskId) throw new Error("task_mismatch")
		if (!isValidAnchor(snapshot, input.apiHistory?.length ?? input.apiHistoryLength)) {
			throw new Error("corrupt_anchor")
		}
		return {
			snapshot,
			apiTail: input.apiHistory ? input.apiHistory.slice(snapshot.apiIndex + 1) : input.apiTail,
			uiTail: input.uiHistory ? selectResumeUiTail(snapshot, input.uiHistory) : input.uiTail,
			apiTailStartIndex: input.apiHistory ? snapshot.apiIndex + 1 : (input.apiTailStartIndex ?? snapshot.apiIndex + 1),
			diagnostics: [],
		}
	} catch (error) {
		const reason = rebuildReason(error, input.snapshot, input.taskId)
		const apiHistory =
			input.apiHistory ?? (input.apiTailStartIndex === 0 || input.apiTailStartIndex === undefined ? input.apiTail : [])
		const built = buildResumeSnapshot({ taskId: input.taskId, uiHistory: fullUiHistory, apiHistory })
		const snapshot = cloneSnapshot(built.snapshot)
		return {
			snapshot,
			apiTail: apiHistory.slice(built.apiTailStartIndex),
			uiTail: built.apiTailStartIndex === 0 ? fullUiHistory : selectResumeUiTail(snapshot, fullUiHistory),
			apiTailStartIndex: built.apiTailStartIndex,
			diagnostics: [{ code: "snapshot_rebuilt", reason }],
		}
	}
}

function interactionKind(message: ClineMessage): InteractionKind | undefined {
	return message.type === "ask" && message.ask ? ASK_INTERACTIONS[message.ask] : undefined
}

function bindPersistedInteraction(snapshot: TaskSnapshot, message: ClineMessage, kind: InteractionKind): void {
	const interactionId = message.interactionId
	const taskId = snapshot.taskId
	if (!interactionId || !taskId) return
	const matchingTurn = snapshot.turn?.blocks.some((block) => block.dlineTid === interactionId) ? snapshot.turn : undefined
	const existing = snapshot.interaction?.interactionId === interactionId ? snapshot.interaction : undefined
	const turnId = matchingTurn?.turnId ?? existing?.turnId ?? snapshot.anchor?.turnId ?? `turn:${interactionId}`
	const status = existing?.status === "resolving" ? "resolving" : "awaiting"
	snapshot.interaction = {
		taskId,
		turnId,
		interactionId,
		kind,
		status,
		createdRevision: existing?.createdRevision ?? snapshot.revision ?? 0,
		anchor: { messageTs: message.ts, messageType: "ask" },
		...(status === "resolving" && existing?.acceptedResponse ? { acceptedResponse: existing.acceptedResponse } : {}),
	}
	snapshot.anchor = {
		apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
		turnId,
		interactionId,
		uiMessageTs: message.ts,
	}

	if (matchingTurn) {
		const block = matchingTurn.blocks.find((candidate) => candidate.dlineTid === interactionId)
		if (block && !TERMINAL_BLOCK_PHASES.has(block.phase)) {
			block.phase = BlockPhase.AWAITING_APPROVAL
			block.requiresApproval = true
			matchingTurn.activeDlineTid = interactionId
		}
	}

	if (kind === "completion") {
		snapshot.phase = TaskPhase.COMPLETED
		snapshot.completion = { completionId: interactionId }
	} else if (kind === "resume") {
		snapshot.phase = TaskPhase.PAUSED
		snapshot.completion = undefined
	} else {
		snapshot.phase = TaskPhase.AWAITING_APPROVAL
		snapshot.completion = undefined
	}
}

function reconcilePersistedInteraction(
	snapshot: TaskSnapshot,
	uiMessages: readonly ClineMessage[],
	answeredDlineTids: ReadonlySet<string>,
	diagnostics: ResumeDiagnostic[],
): void {
	const current = snapshot.interaction
	if (current && answeredDlineTids.has(current.interactionId)) {
		snapshot.interaction = undefined
		snapshot.completion = undefined
	}

	const currentTurnIndex = snapshot.turn?.assistantApiIndex ?? snapshot.apiIndex
	let latest: { message: ClineMessage; kind: InteractionKind } | undefined
	for (const message of uiMessages) {
		const kind = interactionKind(message)
		if (!kind || !message.interactionId || answeredDlineTids.has(message.interactionId)) continue
		const preservesKnownIdentity =
			message.interactionId === snapshot.interaction?.interactionId ||
			message.interactionId === snapshot.completion?.completionId
		if (
			!preservesKnownIdentity &&
			message.conversationHistoryIndex !== undefined &&
			message.conversationHistoryIndex < currentTurnIndex
		) {
			continue
		}
		latest = { message, kind }
	}

	if (!latest) {
		if (snapshot.interaction) {
			if (snapshot.interaction.kind === "completion") {
				snapshot.phase = TaskPhase.COMPLETED
				snapshot.completion = { completionId: snapshot.interaction.interactionId }
				snapshot.interaction.status = "opening"
				snapshot.interaction.anchor = undefined
				snapshot.interaction.acceptedResponse = undefined
				snapshot.anchor = {
					apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
					turnId: snapshot.interaction.turnId,
					interactionId: snapshot.interaction.interactionId,
				}
				return
			}
			const expectedAsk = getInteraction(snapshot.interaction.kind).taskAsk
			const anchored = uiMessages.find(
				(message) =>
					message.type === "ask" &&
					message.ask === expectedAsk &&
					message.interactionId === snapshot.interaction?.interactionId,
			)
			if (anchored) {
				bindPersistedInteraction(snapshot, anchored, snapshot.interaction.kind)
				return
			}
			diagnostics.push({ code: "missing_interaction_anchor", interactionId: snapshot.interaction.interactionId })
			snapshot.interaction = undefined
			snapshot.completion = undefined
		}
		return
	}

	bindPersistedInteraction(snapshot, latest.message, latest.kind)
}

function stopWithoutChangingInteraction(snapshot: TaskSnapshot): void {
	snapshot.cancellation = undefined
	if (snapshot.interaction) return
	if (snapshot.phase === TaskPhase.COMPLETED && snapshot.completion) return
	snapshot.phase = TaskPhase.PAUSED
}

/** Materialize an inert Resume interaction for a stopped state with no original interaction. */
function ensureResumeInteraction(snapshot: TaskSnapshot): ResumeEntry {
	const taskId = snapshot.taskId
	if (!taskId) throw new Error("resume_snapshot_task_missing")
	const revision = (snapshot.revision ?? 0) + 1
	const apiIndex = snapshot.anchor?.apiIndex ?? snapshot.apiIndex
	const interactionId = `resume:${taskId}:${apiIndex}:${revision}`
	const turnId = snapshot.turn?.turnId ?? interactionId
	snapshot.revision = revision
	snapshot.phase = TaskPhase.PAUSED
	snapshot.interaction = {
		taskId,
		turnId,
		interactionId,
		kind: "resume",
		status: "opening",
		createdRevision: revision,
	}
	snapshot.anchor = { apiIndex, turnId, interactionId }
	return { type: "show_resume_interaction", interactionId, turnId }
}

/** Restore a completion footer even when the crash preceded its ask-row append. */
function ensureCompletionInteraction(snapshot: TaskSnapshot, entry: ResumeEntry): ResumeEntry {
	if (entry.type !== "show_completion_interaction" || snapshot.interaction) return entry
	const taskId = snapshot.taskId
	if (!taskId) throw new Error("completion_snapshot_task_missing")
	const revision = (snapshot.revision ?? 0) + 1
	snapshot.revision = revision
	snapshot.phase = TaskPhase.COMPLETED
	snapshot.interaction = {
		taskId,
		turnId: entry.turnId,
		interactionId: entry.interactionId,
		kind: "completion",
		status: "opening",
		createdRevision: revision,
	}
	snapshot.anchor = {
		apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
		turnId: entry.turnId,
		interactionId: entry.interactionId,
	}
	return entry
}

function completionEntry(snapshot: TaskSnapshot): ResumeEntry | undefined {
	const completionId = snapshot.completion?.completionId
	if (!completionId) return undefined
	const completionBlock = snapshot.turn?.blocks.find(
		(block) => block.dlineTid === completionId && block.toolName === "attempt_completion",
	)
	if (!completionBlock) return undefined
	const turnId = snapshot.turn?.turnId ?? snapshot.anchor?.turnId
	if (!turnId) return undefined
	return { type: "show_completion_interaction", interactionId: completionId, turnId }
}

/** Reconcile persisted state into a stopped task without dispatching API or tool work. */
export function reconcileResume(input: ResumeInput): ResumeResult {
	const prepared = prepareInput(input)
	const diagnostics = [...prepared.diagnostics]
	const folded = foldResumeTail({
		snapshot: prepared.snapshot,
		apiTail: prepared.apiTail,
		uiTail: prepared.uiTail,
		apiTailStartIndex: prepared.apiTailStartIndex,
	})
	diagnostics.push(...folded.diagnostics)
	const next = folded.snapshot

	if (next.runtimeError) {
		diagnostics.push({ code: "unsafe_runtime_error", effectType: next.runtimeError.effectType })
		next.runtimeError = undefined
	}

	reconcilePersistedInteraction(next, prepared.uiTail, folded.answeredDlineTids, diagnostics)
	stopWithoutChangingInteraction(next)

	if (next.interaction) {
		if (next.interaction.status === "opening" && next.interaction.anchor) next.interaction.status = "awaiting"
		if (
			next.interaction.status === "resolving" &&
			(next.interaction.kind === "completion" ||
				next.interaction.kind === "resume" ||
				next.interaction.kind === "error_retry")
		) {
			next.interaction.status = "awaiting"
			next.interaction.acceptedResponse = undefined
		}
		if (
			next.interaction.status === "resolving" &&
			next.interaction.kind !== "resume" &&
			next.interaction.kind !== "error_retry"
		) {
			next.interaction = undefined
			next.phase = TaskPhase.PAUSED
			return { snapshot: next, entry: ensureResumeInteraction(next), diagnostics }
		}
		return { snapshot: next, entry: selectAwaitingResumeEntry(next), diagnostics }
	}

	const completed = completionEntry(next)
	if (completed) return { snapshot: next, entry: ensureCompletionInteraction(next, completed), diagnostics }
	if (diagnostics.some((diagnostic) => diagnostic.code === "missing_interaction_anchor")) {
		return { snapshot: next, entry: ensureResumeInteraction(next), diagnostics }
	}

	const turn = next.turn
	const pending = turn?.blocks.filter((block) => !TERMINAL_BLOCK_PHASES.has(block.phase)) ?? []
	if (turn && pending.length > 0 && folded.diagnostics.length === 0) {
		const entry = ensureResumeInteraction(next)
		return {
			snapshot: next,
			entry,
			diagnostics,
		}
	}

	if (folded.diagnostics.length > 0) {
		return { snapshot: next, entry: ensureResumeInteraction(next), diagnostics }
	}
	return { snapshot: next, entry: ensureResumeInteraction(next), diagnostics }
}
