import type { ClineSay } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { InteractionDraft } from "../interaction/InteractionResponse"
import type { NewTaskHandoff } from "../new-task/new-task-handoff"

/** Effect categories emitted by the task reducer. */
export type TaskEffectType =
	| "POST_TASK_VIEW"
	| "PERSIST_SNAPSHOT"
	| "CANCEL_RUNTIME"
	| "PREPARE_RESUME"
	| "START_API"
	| "EXECUTE_TOOL"
	| "APPEND_SAY"
	| "APPEND_ASK"
	| "START_NEW_TASK"
	| "START_SUCCESSOR_TASK"

/** Refresh the Webview from the already committed runtime state. */
export interface PostTaskViewEffect {
	id: string
	type: "POST_TASK_VIEW"
}

/** Persist the already committed runtime aggregate. */
export interface PersistSnapshotEffect {
	id: string
	type: "PERSIST_SNAPSHOT"
}

/** Cancel active API, hook, command, and partial tool work. */
export interface CancelRuntimeEffect {
	id: string
	type: "CANCEL_RUNTIME"
}

/** Reset cancellation-only infrastructure before any resume side effect. */
export interface PrepareResumeEffect {
	id: string
	type: "PREPARE_RESUME"
}

/** Start an API request for a known history index. */
export interface StartApiEffect {
	id: string
	type: "START_API"
	apiIndex: number
	draft?: InteractionDraft
	/** Apply the mistake-limit feedback contract before starting the provider. */
	contentTransform?: "mistake_limit"
	/** Resume one request whose complete user message is already durable at apiIndex. */
	persistedRequest?: boolean
}

/** Execute one canonical tool lifecycle identity. */
export interface ExecuteToolEffect {
	id: string
	type: "EXECUTE_TOOL"
	dlineTid: string
}

/** Append a presentation-only timeline message. */
export interface AppendSayEffect {
	id: string
	type: "APPEND_SAY"
	/** Stable causal identity used to make continuation feedback idempotent. */
	interactionId?: string
	taskSay: ClineSay
	presentation: string
	images?: string[]
	files?: string[]
	/** Legacy handler response identity used to suppress a duplicate handler-level echo. */
	feedbackAcknowledgment?: ClineAskResponse
}

/** Append an interaction presentation anchor. */
export interface AppendAskEffect {
	id: string
	type: "APPEND_ASK"
	interactionId: string
	taskAsk: string
	presentation: string
	existingTs?: number
}

/** Terminate the current task and create the requested successor transaction. */
export interface StartNewTaskEffect {
	id: string
	type: "START_NEW_TASK"
	draft: InteractionDraft
}

/** Start an independent successor through the current surface Controller. */
export interface StartSuccessorTaskEffect {
	id: string
	type: "START_SUCCESSOR_TASK"
	handoff: NewTaskHandoff
}

/** Data-only side effects emitted by task transitions. */
export type TaskEffect =
	| PostTaskViewEffect
	| PersistSnapshotEffect
	| CancelRuntimeEffect
	| PrepareResumeEffect
	| StartApiEffect
	| ExecuteToolEffect
	| AppendSayEffect
	| AppendAskEffect
	| StartNewTaskEffect
	| StartSuccessorTaskEffect
