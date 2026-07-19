import type { ClineSay } from "@shared/ExtensionMessage"
import type { InteractionDraft } from "../interaction/InteractionResponse"

/** Effect categories emitted by the task reducer. */
export type TaskEffectType =
	| "POST_TASK_VIEW"
	| "PERSIST_SNAPSHOT"
	| "CANCEL_RUNTIME"
	| "START_API"
	| "EXECUTE_TOOL"
	| "APPEND_SAY"
	| "APPEND_ASK"
	| "START_NEW_TASK"

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

/** Start an API request for a known history index. */
export interface StartApiEffect {
	id: string
	type: "START_API"
	apiIndex: number
	draft?: InteractionDraft
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
	taskSay: ClineSay
	presentation: string
	images?: string[]
	files?: string[]
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

/** Data-only side effects emitted by task transitions. */
export type TaskEffect =
	| PostTaskViewEffect
	| PersistSnapshotEffect
	| CancelRuntimeEffect
	| StartApiEffect
	| ExecuteToolEffect
	| AppendSayEffect
	| AppendAskEffect
	| StartNewTaskEffect
