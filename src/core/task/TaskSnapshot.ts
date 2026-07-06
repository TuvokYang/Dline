import type { ClineAsk } from "@shared/ExtensionMessage"
import type { BlockPhase } from "./TaskController"
import type { TaskPhase } from "./TaskPhase"

/**
 * Type guard that validates an apiIndex is a non-negative integer
 * within the bounds of the apiConversationHistory array.
 * Exported as a shared utility so both Task (index.ts) and
 * ResumeHandler can validate snapshot apiIndex fields consistently.
 */
export function isValidApiIndex(index: unknown, historyLength: number): index is number {
	return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < historyLength
}

/**
 * Awaiting kinds classify what the task is waiting for.
 */
export type TaskSnapshotAwaitingKind = "none" | "conversation" | "approval" | "resume" | "completion" | "error_recovery"

/**
 * Awaiting context stored in a TaskSnapshot to classify waiting states.
 */
export interface TaskSnapshotAwaiting {
	kind: TaskSnapshotAwaitingKind
	taskAsk?: ClineAsk
	activeCallId?: string
	messageTs?: number
}

/**
 * Block status reason tracks why a block is in its current phase.
 */
export type TaskSnapshotBlockStatusReason =
	| "ready"
	| "auto_approved"
	| "awaiting_user"
	| "user_approved"
	| "user_rejected"
	| "cascade_skipped"
	| "user_cancelled"
	| "completed"
	| "restored"

/**
 * Approval context stored in a TaskSnapshot when phase is AWAITING_APPROVAL.
 */
export interface TaskSnapshotApproval {
	mode: "serial" | "parallel"
	blocks: Array<{
		callId: string
		name: string
		phase: BlockPhase
		/** Index of this block's tool_use in apiConversationHistory */
		apiIndex: number
		askType?: ClineAsk
		requiresApproval?: boolean
		ts?: number
		statusReason?: TaskSnapshotBlockStatusReason
	}>
	activeCallId?: string
}

/**
 * Execution context stored in a TaskSnapshot when phase is EXECUTING.
 */
export interface TaskSnapshotExecution {
	mode: "serial" | "parallel"
	/** callId list of currently executing tools */
	executing: string[]
}

/**
 * Resume context stored in a TaskSnapshot when phase is RESUMING.
 */
export interface TaskSnapshotResume {
	/** Index of the assistant message with pending tools in apiConversationHistory */
	assistantApiIndex: number
	pendingToolUseIds: string[]
	answeredToolUseIds: string[]
}

/**
 * Cancel context stored in a TaskSnapshot when phase is CANCELLING.
 */
export interface TaskSnapshotCancel {
	source: "user" | "hook" | "abort"
	fromPhase: TaskPhase
}

/**
 * Error recovery kind classifies the type of error awaiting user action.
 */
export type TaskSnapshotErrorKind = "api_req_failed" | "mistake_limit_reached"

/**
 * Error recovery action types available to user.
 */
export type TaskSnapshotErrorAction = "retry" | "process_anyway" | "start_new_task"

/**
 * Error recovery context stored in a TaskSnapshot when awaiting error recovery.
 */
export interface TaskSnapshotErrorRecovery {
	kind: TaskSnapshotErrorKind
	sourceAsk: ClineAsk
	message: string
	actions: TaskSnapshotErrorAction[]
	messageTs?: number
	retryable: boolean
	processAllowed: boolean
}

/**
 * State snapshot persisted as a state_snapshot message in ui_messages.jsonl.
 *
 * On resume, the latest snapshot is read to determine the exact recovery action
 * without re-inferring state from message history. The apiIndex field links
 * directly into apiConversationHistory for fromHistory replay.
 */
export interface TaskSnapshot {
	phase: TaskPhase
	/** Last index in apiConversationHistory that this snapshot corresponds to */
	apiIndex: number
	timestamp: number
	awaiting?: TaskSnapshotAwaiting
	approval?: TaskSnapshotApproval
	execution?: TaskSnapshotExecution
	resume?: TaskSnapshotResume
	cancel?: TaskSnapshotCancel
	error?: TaskSnapshotErrorRecovery
}
