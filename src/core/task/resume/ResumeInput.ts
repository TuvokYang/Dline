import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineStorageMessage } from "@shared/messages"
import type { InteractionDraft } from "../interaction/InteractionResponse"
import type { TaskSnapshot, TaskSnapshotIdentityField } from "../TaskSnapshot"

/** Immutable inputs used by the only message-derived resume boundary. */
export interface ResumeInput {
	taskId: string
	snapshot: TaskSnapshot
	uiTail: readonly ClineMessage[]
	apiTail: readonly ClineStorageMessage[]
	apiHistoryLength: number
}

/** Allowed post-reconciliation entry selected without service calls. */
export type ResumeEntry =
	| { type: "continue_api_turn"; apiIndex: number; draft?: InteractionDraft }
	| { type: "reopen_interaction"; interactionId: string; turnId: string }
	| { type: "replay_pending_blocks"; turnId: string; dlineTids: string[]; answeredDlineTids: string[] }
	| { type: "show_resume_interaction"; interactionId?: string; turnId?: string }
	| { type: "show_completion_interaction"; interactionId: string; turnId: string }
	| { type: "show_error_recovery"; interactionId: string; turnId: string; apiIndex: number }
	| { type: "read_only_failure"; diagnostics?: ResumeDiagnostic[] }

/** Typed reconciliation diagnostic that never guesses missing identity or anchors. */
export type ResumeDiagnostic =
	| { code: "invalid_snapshot_version" }
	| { code: "task_mismatch"; expected: string; actual?: string }
	| { code: "corrupt_anchor"; field: "apiIndex" | "uiMessageTs" }
	| { code: "missing_identity"; field: TaskSnapshotIdentityField }
	| { code: "missing_interaction_anchor"; interactionId: string }
	| { code: "unmatched_tool_result"; dlineTid: string }

/** Complete pure result consumed by the resume coordinator. */
export interface ResumeResult {
	snapshot: TaskSnapshot
	entry: ResumeEntry
	diagnostics: ResumeDiagnostic[]
}
