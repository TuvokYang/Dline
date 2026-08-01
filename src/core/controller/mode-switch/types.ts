import type { ChatContent } from "@shared/ChatContent"
import type { Mode } from "@shared/storage/types"

/** Effective task-local profile information for one mode. */
export interface ResolvedModeProfile {
	mode: Mode
	profile: string
	contextWindow: number
}

/** Resolve effective source and target profiles without Webview dependencies. */
export interface ModeProfileResolver {
	getSource(): ResolvedModeProfile | undefined
	resolve(mode: Mode): ResolvedModeProfile | undefined
}

/** Read canonical current context occupancy for the active task. */
export interface ContextPressureReader {
	read(): number
}

/** Run source-mode compaction and control its completion barrier. */
export interface TaskCompactionPort {
	compact(operationId: string, chatContent?: ChatContent): Promise<"completed" | "cancelled" | "failed">
	release(operationId: string): void
	fail(operationId: string, reason: string): void
}

/** Validate and atomically commit one task-local target mode. */
export interface ModeCommitPort {
	validate(operation: ModeSwitchOperation): boolean
	commit(operation: ModeSwitchOperation): Promise<void>
}

/** User request to switch one task to a target mode. */
export interface ModeSwitchRequest {
	taskId: string
	targetMode: Mode
	chatContent?: ChatContent
}

/** Immutable internal transaction data retained across confirmation. */
export interface ModeSwitchOperation {
	operationId: string
	taskId: string
	source: ResolvedModeProfile
	target: ResolvedModeProfile
	currentTokens: number
	triggerTokens: number
	chatContent?: ChatContent
}
