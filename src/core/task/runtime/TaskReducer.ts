import { BlockPhase } from "../BlockPhaseMachine"
import { reduceInteraction } from "../interaction/InteractionReducer"
import { getInteraction } from "../interaction/InteractionRegistry"
import type { InteractionResponseErrorCode } from "../interaction/InteractionResponse"
import { TaskPhase } from "../TaskPhase"
import { TaskPhaseMachine } from "../TaskPhaseMachine"
import type { TaskEffect } from "./TaskEffect"
import type { TaskEvent } from "./TaskEvent"
import type { TaskRuntimeState } from "./TaskRuntimeState"

/** Typed rejection returned for an event that is invalid in the current phase. */
export interface RuntimeEventError {
	code: "invalid_runtime_event" | InteractionResponseErrorCode
	eventType: TaskEvent["type"]
	phase: TaskPhase
}

/** Pure transition output consumed by TaskRuntime. */
export interface TransitionResult {
	accepted: boolean
	next: TaskRuntimeState
	effects: TaskEffect[]
	error?: RuntimeEventError
}

interface AcceptedChange {
	eventType: TaskEvent["type"]
	phase: TaskPhase
	anchor?: TaskRuntimeState["anchor"]
	cancellation?: TaskRuntimeState["cancellation"] | null
	error?: TaskRuntimeState["error"] | null
	completion?: TaskRuntimeState["completion"] | null
	turn?: TaskRuntimeState["turn"] | null
	interaction?: TaskRuntimeState["interaction"] | null
	effects?: TaskEffect[]
}

/** Create a stable effect identity from the next state revision and sequence. */
function effectId(revision: number, sequence: number): string {
	return `task-effect-${revision}-${sequence}`
}

/** Create the standard view and persistence effects for one transition. */
function stateEffects(revision: number): TaskEffect[] {
	return [
		{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
		{ id: effectId(revision, 2), type: "PERSIST_SNAPSHOT" },
	]
}

/** Return whether a phase transition is allowed by the canonical phase machine. */
function canTransition(from: TaskPhase, to: TaskPhase): boolean {
	const machine = new TaskPhaseMachine()
	machine.restoreFrom({ phase: from, apiIndex: -1, timestamp: 1 })
	return machine.canTransition(to)
}

/** Build one accepted immutable runtime transition. */
function accept(state: TaskRuntimeState, change: AcceptedChange): TransitionResult {
	if (!canTransition(state.phase, change.phase)) {
		return reject(state, change.eventType)
	}

	const revision = state.revision + 1
	const next: TaskRuntimeState = {
		...state,
		phase: change.phase,
		revision,
		anchor: change.anchor ?? state.anchor,
	}

	if (change.cancellation === null) {
		delete next.cancellation
	} else if (change.cancellation !== undefined) {
		next.cancellation = change.cancellation
	}
	if (change.error === null) {
		delete next.error
	} else if (change.error !== undefined) {
		next.error = change.error
	}
	if (change.completion === null) {
		delete next.completion
	} else if (change.completion !== undefined) {
		next.completion = change.completion
	}
	if (change.turn === null) {
		delete next.turn
	} else if (change.turn !== undefined) {
		next.turn = change.turn
	}
	if (change.interaction === null) {
		delete next.interaction
	} else if (change.interaction !== undefined) {
		next.interaction = change.interaction
	}

	return {
		accepted: true,
		next,
		effects: change.effects ?? stateEffects(revision),
	}
}

/** Return an unchanged state for a typed runtime rejection. */
function reject(
	state: TaskRuntimeState,
	eventType: TaskEvent["type"],
	code: RuntimeEventError["code"] = "invalid_runtime_event",
): TransitionResult {
	return {
		accepted: false,
		next: state,
		effects: [],
		error: { code, eventType, phase: state.phase },
	}
}

/** Commit an interaction update without requiring a task phase self-transition. */
function acceptInteraction(
	state: TaskRuntimeState,
	interaction: TaskRuntimeState["interaction"],
	anchor: TaskRuntimeState["anchor"] = state.anchor,
): TransitionResult {
	const revision = state.revision + 1
	return {
		accepted: true,
		next: { ...state, revision, anchor, interaction },
		effects: stateEffects(revision),
	}
}

/** Reduce one initialization event without performing side effects. */
function reduceInitialize(state: TaskRuntimeState, event: TaskEvent): TransitionResult {
	if (event.type === "TASK_INITIALIZE_REQUESTED" && state.phase === TaskPhase.IDLE) {
		return accept(state, { eventType: event.type, phase: TaskPhase.INITIALIZING })
	}
	if (event.type === "TASK_INITIALIZED" && state.phase === TaskPhase.INITIALIZING) {
		return accept(state, {
			eventType: event.type,
			phase: event.hasTask ? TaskPhase.STREAMING : TaskPhase.WAITING_FOR_TASK,
			anchor: event.anchor,
		})
	}
	return reject(state, event.type)
}

/** Reduce one API lifecycle event without performing side effects. */
function reduceApi(state: TaskRuntimeState, event: Extract<TaskEvent, { type: "API_REQUEST_STARTED" }>): TransitionResult {
	if (state.phase === TaskPhase.STREAMING) {
		const revision = state.revision + 1
		return {
			accepted: true,
			next: { ...state, revision, anchor: { ...state.anchor, apiIndex: event.apiIndex } },
			effects: stateEffects(revision),
		}
	}
	if (!canTransition(state.phase, TaskPhase.STREAMING)) {
		return reject(state, event.type)
	}
	return accept(state, {
		eventType: event.type,
		phase: TaskPhase.STREAMING,
		anchor: { ...state.anchor, apiIndex: event.apiIndex },
	})
}

/** Start one reconciled API continuation without reading persisted messages. */
function reduceResumeApi(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "RESUME_API_CONTINUATION_REQUESTED" }>,
): TransitionResult {
	if (state.interaction || event.apiIndex !== state.anchor.apiIndex) {
		return reject(state, event.type)
	}
	if (state.phase !== TaskPhase.STREAMING && !canTransition(state.phase, TaskPhase.STREAMING)) {
		return reject(state, event.type)
	}
	const revision = state.revision + 1
	return {
		accepted: true,
		next: { ...state, phase: TaskPhase.STREAMING, revision, anchor: { ...state.anchor, apiIndex: event.apiIndex } },
		effects: [
			{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
			{
				id: effectId(revision, 2),
				type: "START_API",
				apiIndex: event.apiIndex,
				...(event.draft ? { draft: event.draft } : {}),
			},
			{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
		],
	}
}

/** Reset only reconciled non-terminal blocks before replaying their normal handler lifecycle. */
function reduceResumeBlocks(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "RESUME_BLOCK_REPLAY_REQUESTED" }>,
): TransitionResult {
	if (!state.turn || state.turn.turnId !== event.turnId || event.dlineTids.length === 0) {
		return reject(state, event.type)
	}
	const requested = new Set(event.dlineTids)
	if (requested.size !== event.dlineTids.length) {
		return reject(state, event.type)
	}
	if (state.turn.blocks.some((block) => requested.has(block.dlineTid) && isTerminalBlock(block.phase))) {
		return reject(state, event.type)
	}
	const blocks = state.turn.blocks.map((block) =>
		requested.has(block.dlineTid) ? { ...block, phase: BlockPhase.STREAMING } : block,
	)
	if (blocks.filter((block) => requested.has(block.dlineTid)).length !== requested.size) {
		return reject(state, event.type)
	}
	return acceptTurn(state, event.type, { ...state.turn, blocks, activeDlineTid: undefined }, TaskPhase.STREAMING)
}

/** Return one block from the active canonical turn. */
function findTurnBlock(state: TaskRuntimeState, turnId: string, dlineTid: string) {
	if (!state.turn || state.turn.turnId !== turnId) {
		return undefined
	}
	return state.turn.blocks.find((block) => block.dlineTid === dlineTid)
}

/** Replace one block immutably in the active turn. */
function replaceTurnBlock(
	state: TaskRuntimeState,
	dlineTid: string,
	phase: BlockPhase,
	activeDlineTid: string | undefined = state.turn?.activeDlineTid,
): TaskRuntimeState["turn"] {
	if (!state.turn) {
		return undefined
	}
	return {
		...state.turn,
		activeDlineTid,
		blocks: state.turn.blocks.map((block) => (block.dlineTid === dlineTid ? { ...block, phase } : block)),
	}
}

/** Commit one turn update while preserving or explicitly changing phase. */
function acceptTurn(
	state: TaskRuntimeState,
	eventType: TaskEvent["type"],
	turn: NonNullable<TaskRuntimeState["turn"]>,
	phase: TaskPhase = state.phase,
	effects?: TaskEffect[],
): TransitionResult {
	if (phase !== state.phase) {
		return accept(state, { eventType, phase, turn, anchor: { ...state.anchor, turnId: turn.turnId }, effects })
	}
	const revision = state.revision + 1
	return {
		accepted: true,
		next: { ...state, revision, turn, anchor: { ...state.anchor, turnId: turn.turnId } },
		effects: effects ?? stateEffects(revision),
	}
}

/** Create or advance one canonical assistant turn. */
function reduceTurn(
	state: TaskRuntimeState,
	event: Extract<
		TaskEvent,
		{
			type:
				| "TURN_CREATED"
				| "BLOCK_READY"
				| "BLOCK_APPROVAL_REQUIRED"
				| "BLOCK_APPROVED"
				| "BLOCK_REJECTED"
				| "BLOCK_EXECUTION_STARTED"
				| "BLOCK_EXECUTION_COMPLETED"
				| "TURN_COMPLETED"
		}
	>,
): TransitionResult {
	if (event.type === "TURN_CREATED") {
		if (state.turn?.blocks.some((block) => !isTerminalBlock(block.phase))) {
			return reject(state, event.type)
		}
		return acceptTurn(state, event.type, {
			turnId: event.turnId,
			assistantApiIndex: event.assistantApiIndex,
			mode: event.mode,
			blocks: event.blocks.map((block) => ({ ...block, phase: BlockPhase.STREAMING })),
		})
	}

	if (!state.turn || state.turn.turnId !== event.turnId) {
		return reject(state, event.type)
	}
	if (event.type === "TURN_COMPLETED") {
		if (!state.turn.blocks.every((block) => isTerminalBlock(block.phase))) {
			return reject(state, event.type)
		}
		return acceptTurn(state, event.type, { ...state.turn, activeDlineTid: undefined }, TaskPhase.BETWEEN_TURNS)
	}

	const block = findTurnBlock(state, event.turnId, event.dlineTid)
	if (!block) {
		return reject(state, event.type)
	}
	if (event.type === "BLOCK_READY") {
		if (block.phase !== BlockPhase.STREAMING) {
			return reject(state, event.type)
		}
		if (block.requiresApproval) {
			return acceptTurn(state, event.type, state.turn)
		}
		const turn = replaceTurnBlock(state, block.dlineTid, BlockPhase.AUTO_EXECUTING)
		return turn ? acceptTurn(state, event.type, turn) : reject(state, event.type)
	}
	if (event.type === "BLOCK_APPROVAL_REQUIRED") {
		if (block.phase !== BlockPhase.STREAMING || state.turn.activeDlineTid) {
			return reject(state, event.type)
		}
		const turn = replaceTurnBlock(state, block.dlineTid, BlockPhase.AWAITING_APPROVAL, block.dlineTid)
		return turn ? acceptTurn(state, event.type, turn, TaskPhase.AWAITING_APPROVAL) : reject(state, event.type)
	}
	if (event.type === "BLOCK_APPROVED") {
		if (block.phase !== BlockPhase.AWAITING_APPROVAL || state.turn.activeDlineTid !== block.dlineTid) {
			return reject(state, event.type)
		}
		const turn = replaceTurnBlock(state, block.dlineTid, BlockPhase.EXECUTING, block.dlineTid)
		return turn ? acceptTurn(state, event.type, turn, TaskPhase.EXECUTING) : reject(state, event.type)
	}
	if (event.type === "BLOCK_REJECTED") {
		if (block.phase !== BlockPhase.AWAITING_APPROVAL || state.turn.activeDlineTid !== block.dlineTid) {
			return reject(state, event.type)
		}
		let afterRejected = false
		const turn = {
			...state.turn,
			activeDlineTid: undefined,
			blocks: state.turn.blocks.map((candidate) => {
				if (candidate.dlineTid === block.dlineTid) {
					afterRejected = true
					return { ...candidate, phase: BlockPhase.REJECTED }
				}
				if (afterRejected && candidate.requiresApproval && candidate.phase === BlockPhase.STREAMING) {
					return { ...candidate, phase: BlockPhase.SKIPPED }
				}
				return candidate
			}),
		}
		return acceptTurn(state, event.type, turn, TaskPhase.BETWEEN_TURNS)
	}
	if (event.type === "BLOCK_EXECUTION_STARTED") {
		if (block.phase !== BlockPhase.EXECUTING && block.phase !== BlockPhase.AUTO_EXECUTING) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return acceptTurn(state, event.type, state.turn, TaskPhase.EXECUTING, [
			{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
			{ id: effectId(revision, 2), type: "EXECUTE_TOOL", dlineTid: block.dlineTid },
			{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
		])
	}
	if (block.phase !== BlockPhase.EXECUTING && block.phase !== BlockPhase.AUTO_EXECUTING) {
		return reject(state, event.type)
	}
	const turn = replaceTurnBlock(state, block.dlineTid, BlockPhase.COMPLETED, undefined)
	return turn ? acceptTurn(state, event.type, turn, TaskPhase.EXECUTING) : reject(state, event.type)
}

/** Return whether a block has reached a terminal turn phase. */
function isTerminalBlock(phase: BlockPhase): boolean {
	return (
		phase === BlockPhase.COMPLETED ||
		phase === BlockPhase.REJECTED ||
		phase === BlockPhase.SKIPPED ||
		phase === BlockPhase.CANCELLED
	)
}

/** Reduce one interaction checkpoint event without performing side effects. */
function reduceApproval(state: TaskRuntimeState, event: Extract<TaskEvent, { type: "APPROVAL_REQUIRED" }>): TransitionResult {
	if (!canTransition(state.phase, TaskPhase.AWAITING_APPROVAL)) {
		return reject(state, event.type)
	}
	return accept(state, {
		eventType: event.type,
		phase: TaskPhase.AWAITING_APPROVAL,
		anchor: { ...state.anchor, turnId: event.turnId, interactionId: event.interactionId },
	})
}

/** Open one canonical interaction and request its presentation effect. */
function reduceInteractionOpen(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "INTERACTION_OPEN_REQUESTED" }>,
): TransitionResult {
	if (state.interaction) {
		return reject(state, event.type)
	}
	const revision = state.revision + 1
	const definition = getInteraction(event.kind)
	return {
		accepted: true,
		next: {
			...state,
			revision,
			anchor: { ...state.anchor, turnId: event.turnId, interactionId: event.interactionId },
			interaction: {
				taskId: state.taskId,
				turnId: event.turnId,
				interactionId: event.interactionId,
				kind: event.kind,
				status: "opening",
				createdRevision: revision,
			},
		},
		effects: [
			{
				id: effectId(revision, 1),
				type: "APPEND_ASK",
				interactionId: event.interactionId,
				taskAsk: definition.taskAsk,
				presentation: event.presentation,
				existingTs: event.existingTs,
			},
		],
	}
}

/** Bind a persisted ask anchor to the opening interaction. */
function reduceInteractionPresented(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "INTERACTION_PRESENTED" }>,
): TransitionResult {
	const interaction = state.interaction
	if (!interaction || interaction.status !== "opening" || interaction.interactionId !== event.interactionId) {
		return reject(state, event.type)
	}
	return acceptInteraction(
		state,
		{ ...interaction, status: "awaiting", anchor: { messageTs: event.messageTs, messageType: "ask" } },
		{
			...state.anchor,
			uiMessageTs: event.messageTs,
			turnId: interaction.turnId,
			interactionId: interaction.interactionId,
		},
	)
}

/** Remove one resolved interaction only after its response was consumed. */
function reduceInteractionResolved(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "INTERACTION_RESOLVED" }>,
): TransitionResult {
	if (
		!state.interaction ||
		state.interaction.status !== "resolving" ||
		state.interaction.interactionId !== event.interactionId
	) {
		return reject(state, event.type)
	}
	return acceptInteraction(state, undefined)
}

/** Reduce one causal interaction response without reading message history. */
function reduceInteractionResponse(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "INTERACTION_RESPONDED" }>,
): TransitionResult {
	if (!state.interaction || event.response.stateRevision !== state.revision) {
		return reject(state, event.type, "stale_interaction")
	}
	const result = reduceInteraction(state.interaction, event.response)
	if (!result.accepted) {
		return reject(state, event.type, result.error.code)
	}
	const turn = state.turn
	if (!turn || turn.turnId !== event.response.turnId) {
		return acceptInteraction(state, result.next)
	}
	const block = turn.blocks.find((candidate) => candidate.dlineTid === event.response.interactionId)
	if (!block || block.phase !== BlockPhase.AWAITING_APPROVAL || turn.activeDlineTid !== block.dlineTid) {
		return acceptInteraction(state, result.next)
	}
	if (event.response.actionId === "approve") {
		const nextTurn = replaceTurnBlock(state, block.dlineTid, BlockPhase.EXECUTING, block.dlineTid)
		if (!nextTurn || !canTransition(state.phase, TaskPhase.EXECUTING)) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return {
			accepted: true,
			next: { ...state, revision, phase: TaskPhase.EXECUTING, turn: nextTurn, interaction: result.next },
			effects: stateEffects(revision),
		}
	}
	if (event.response.actionId === "reject") {
		let afterRejected = false
		const nextTurn = {
			...turn,
			activeDlineTid: undefined,
			blocks: turn.blocks.map((candidate) => {
				if (candidate.dlineTid === block.dlineTid) {
					afterRejected = true
					return { ...candidate, phase: BlockPhase.REJECTED }
				}
				if (afterRejected && candidate.requiresApproval && candidate.phase === BlockPhase.STREAMING) {
					return { ...candidate, phase: BlockPhase.SKIPPED }
				}
				return candidate
			}),
		}
		const revision = state.revision + 1
		return {
			accepted: true,
			next: { ...state, revision, phase: TaskPhase.BETWEEN_TURNS, turn: nextTurn, interaction: result.next },
			effects: stateEffects(revision),
		}
	}
	return acceptInteraction(state, result.next)
}

/** Create one opening interaction embedded in a lifecycle transaction. */
function openingInteraction(
	state: TaskRuntimeState,
	revision: number,
	input: { turnId: string; interactionId: string; kind: "resume" | "error_retry" | "completion" },
): NonNullable<TaskRuntimeState["interaction"]> {
	return {
		taskId: state.taskId,
		turnId: input.turnId,
		interactionId: input.interactionId,
		kind: input.kind,
		status: "opening",
		createdRevision: revision,
	}
}

/** Create the ordered effects for a lifecycle transaction that presents one interaction. */
function interactionEffects(
	revision: number,
	input: { interactionId: string; taskAsk: string; presentation: string; existingTs?: number },
): TaskEffect[] {
	return [
		{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
		{
			id: effectId(revision, 2),
			type: "APPEND_ASK",
			interactionId: input.interactionId,
			taskAsk: input.taskAsk,
			presentation: input.presentation,
			existingTs: input.existingTs,
		},
		{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
	]
}

/** Reduce one cancellation lifecycle event without performing side effects. */
function reduceCancel(
	state: TaskRuntimeState,
	event: Extract<TaskEvent, { type: "TASK_CANCEL_REQUESTED" | "TASK_CANCELLED" }>,
): TransitionResult {
	if (event.type === "TASK_CANCEL_REQUESTED") {
		if (!canTransition(state.phase, TaskPhase.CANCELLING)) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return accept(state, {
			eventType: event.type,
			phase: TaskPhase.CANCELLING,
			cancellation: { source: event.source, fromPhase: state.phase },
			interaction: null,
			effects: [
				{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
				{ id: effectId(revision, 2), type: "CANCEL_RUNTIME" },
				{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
			],
		})
	}
	if (state.phase !== TaskPhase.CANCELLING) {
		return reject(state, event.type)
	}
	if (!event.resume) {
		return accept(state, { eventType: event.type, phase: TaskPhase.PAUSED, cancellation: null })
	}
	const revision = state.revision + 1
	return accept(state, {
		eventType: event.type,
		phase: TaskPhase.PAUSED,
		cancellation: null,
		interaction: openingInteraction(state, revision, { ...event.resume, kind: "resume" }),
		anchor: { ...state.anchor, turnId: event.resume.turnId, interactionId: event.resume.interactionId },
		effects: interactionEffects(revision, {
			interactionId: event.resume.interactionId,
			taskAsk: "resume_task",
			presentation: event.resume.presentation,
		}),
	})
}

/** Reduce retry and completion transactions without message-derived inference. */
function reduceRecovery(
	state: TaskRuntimeState,
	event: Extract<
		TaskEvent,
		{
			type:
				| "ERROR_RETRY_REQUESTED"
				| "API_RETRY_SCHEDULED"
				| "API_RETRY_EXHAUSTED"
				| "ATTEMPT_COMPLETION_PRESENTED"
				| "COMPLETION_FEEDBACK_RECEIVED"
				| "TASK_CLEAR_REQUESTED"
		}
	>,
): TransitionResult {
	if (event.type === "API_RETRY_SCHEDULED") {
		if (state.interaction) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return {
			accepted: true,
			next: {
				...state,
				phase: TaskPhase.STREAMING,
				revision,
				anchor: { ...state.anchor, apiIndex: event.apiIndex },
			},
			effects: [
				{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
				{ id: effectId(revision, 2), type: "START_API", apiIndex: event.apiIndex },
				{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
			],
		}
	}
	if (event.type === "ERROR_RETRY_REQUESTED") {
		if (state.interaction?.kind !== "error_retry" || state.interaction.status !== "resolving") {
			return reject(state, event.type)
		}
		if (!canTransition(state.phase, TaskPhase.STREAMING)) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return {
			accepted: true,
			next: {
				...state,
				phase: TaskPhase.STREAMING,
				revision,
				interaction: undefined,
				error: undefined,
				anchor: { ...state.anchor, apiIndex: event.apiIndex, interactionId: undefined },
			},
			effects: [
				{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
				{ id: effectId(revision, 2), type: "START_API", apiIndex: event.apiIndex, draft: event.draft },
				{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
			],
		}
	}
	if (event.type === "API_RETRY_EXHAUSTED") {
		if (!canTransition(state.phase, TaskPhase.AWAITING_APPROVAL) || state.interaction) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return accept(state, {
			eventType: event.type,
			phase: TaskPhase.AWAITING_APPROVAL,
			interaction: openingInteraction(state, revision, { ...event, kind: "error_retry" }),
			anchor: { ...state.anchor, turnId: event.turnId, interactionId: event.interactionId },
			effects: interactionEffects(revision, {
				interactionId: event.interactionId,
				taskAsk: "api_req_failed",
				presentation: event.presentation,
			}),
		})
	}
	if (event.type === "ATTEMPT_COMPLETION_PRESENTED") {
		if (!canTransition(state.phase, TaskPhase.COMPLETED) || state.interaction) {
			return reject(state, event.type)
		}
		const revision = state.revision + 1
		return accept(state, {
			eventType: event.type,
			phase: TaskPhase.COMPLETED,
			completion: { completionId: event.completionId },
			interaction: openingInteraction(state, revision, { ...event, kind: "completion" }),
			anchor: { ...state.anchor, turnId: event.turnId, interactionId: event.interactionId },
			effects: interactionEffects(revision, {
				interactionId: event.interactionId,
				taskAsk: "completion_result",
				presentation: event.presentation,
				existingTs: event.existingTs,
			}),
		})
	}
	if (event.type === "COMPLETION_FEEDBACK_RECEIVED") {
		if (
			state.phase !== TaskPhase.COMPLETED ||
			state.interaction?.kind !== "completion" ||
			state.interaction.status !== "resolving"
		) {
			return reject(state, event.type)
		}
		return accept(state, {
			eventType: event.type,
			phase: TaskPhase.STREAMING,
			interaction: null,
			completion: null,
			anchor: { ...state.anchor, interactionId: undefined },
		})
	}
	if (
		state.interaction?.status !== "resolving" ||
		(state.interaction.kind !== "completion" && state.interaction.kind !== "error_retry")
	) {
		return reject(state, event.type)
	}
	const revision = state.revision + 1
	return {
		accepted: true,
		next: {
			...state,
			revision,
			interaction: undefined,
			anchor: { ...state.anchor, interactionId: undefined },
		},
		effects: [
			{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
			{ id: effectId(revision, 2), type: "PERSIST_SNAPSHOT" },
			{ id: effectId(revision, 3), type: "START_NEW_TASK", draft: event.draft },
		],
	}
}

/** Reduce one resume request without performing side effects. */
function reduceResume(state: TaskRuntimeState, event: Extract<TaskEvent, { type: "TASK_RESUME_REQUESTED" }>): TransitionResult {
	if (state.phase !== TaskPhase.PAUSED) {
		return reject(state, event.type)
	}
	if (
		!state.interaction ||
		state.interaction.kind !== "resume" ||
		state.interaction.status !== "resolving" ||
		state.interaction.interactionId !== event.interactionId
	) {
		return reject(state, event.type)
	}
	const revision = state.revision + 1
	return accept(state, {
		eventType: event.type,
		phase: TaskPhase.RESUMING,
		interaction: null,
		anchor: { ...state.anchor, interactionId: undefined },
		error: null,
		effects: [
			{ id: effectId(revision, 1), type: "POST_TASK_VIEW" },
			{ id: effectId(revision, 2), type: "START_API", apiIndex: state.anchor.apiIndex, draft: event.draft },
			{ id: effectId(revision, 3), type: "PERSIST_SNAPSHOT" },
		],
	})
}

/** Reduce one completion event without performing side effects. */
function reduceCompletion(state: TaskRuntimeState, event: Extract<TaskEvent, { type: "TASK_COMPLETED" }>): TransitionResult {
	if (!canTransition(state.phase, TaskPhase.COMPLETED)) {
		return reject(state, event.type)
	}
	return accept(state, {
		eventType: event.type,
		phase: TaskPhase.COMPLETED,
		completion: { completionId: event.completionId },
	})
}

/** Reduce one effect failure into an explicit paused recovery state. */
function reduceFailure(state: TaskRuntimeState, event: Extract<TaskEvent, { type: "EFFECT_FAILED" }>): TransitionResult {
	if (!canTransition(state.phase, TaskPhase.PAUSED)) {
		return reject(state, event.type)
	}
	const revision = state.revision + 1
	return {
		accepted: true,
		next: {
			...state,
			phase: TaskPhase.PAUSED,
			revision,
			error: {
				effectId: event.effectId,
				effectType: event.effectType,
				message: event.message,
			},
		},
		effects: [],
	}
}

/** Reduce a typed task event into the next state and ordered effects. */
export function reduceTask(state: TaskRuntimeState, event: TaskEvent): TransitionResult {
	switch (event.type) {
		case "TASK_INITIALIZE_REQUESTED":
		case "TASK_INITIALIZED":
			return reduceInitialize(state, event)
		case "API_REQUEST_STARTED":
			return reduceApi(state, event)
		case "RESUME_API_CONTINUATION_REQUESTED":
			return reduceResumeApi(state, event)
		case "RESUME_BLOCK_REPLAY_REQUESTED":
			return reduceResumeBlocks(state, event)
		case "TURN_CREATED":
		case "BLOCK_READY":
		case "BLOCK_APPROVAL_REQUIRED":
		case "BLOCK_APPROVED":
		case "BLOCK_REJECTED":
		case "BLOCK_EXECUTION_STARTED":
		case "BLOCK_EXECUTION_COMPLETED":
		case "TURN_COMPLETED":
			return reduceTurn(state, event)
		case "APPROVAL_REQUIRED":
			return reduceApproval(state, event)
		case "INTERACTION_OPEN_REQUESTED":
			return reduceInteractionOpen(state, event)
		case "INTERACTION_PRESENTED":
			return reduceInteractionPresented(state, event)
		case "INTERACTION_RESPONDED":
			return reduceInteractionResponse(state, event)
		case "INTERACTION_RESOLVED":
			return reduceInteractionResolved(state, event)
		case "TASK_CANCEL_REQUESTED":
		case "TASK_CANCELLED":
			return reduceCancel(state, event)
		case "ERROR_RETRY_REQUESTED":
		case "API_RETRY_SCHEDULED":
		case "API_RETRY_EXHAUSTED":
		case "ATTEMPT_COMPLETION_PRESENTED":
		case "COMPLETION_FEEDBACK_RECEIVED":
		case "TASK_CLEAR_REQUESTED":
			return reduceRecovery(state, event)
		case "TASK_RESUME_REQUESTED":
			return reduceResume(state, event)
		case "TASK_COMPLETED":
			return reduceCompletion(state, event)
		case "EFFECT_FAILED":
			return reduceFailure(state, event)
	}
}
