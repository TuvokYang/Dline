import type { Mode } from "./storage/types"

/** Backend transaction phases projected to the Webview. */
export type ModeSwitchPhase = "idle" | "awaiting_confirmation" | "compacting" | "committing" | "failed"

/** Immediate result statuses returned by mode-switch RPC requests. */
export type ModeSwitchRequestStatus = "switched" | "confirmation_required" | "in_progress" | "rejected"

/** Read-only mode-switch transaction state associated with one task. */
export interface ModeSwitchSnapshot {
	phase: ModeSwitchPhase
	operationId?: string
	taskId?: string
	sourceMode?: Mode
	targetMode?: Mode
	sourceProfile?: string
	targetProfile?: string
	sourceContextWindow?: number
	targetContextWindow?: number
	currentTokens?: number
	triggerTokens?: number
	error?: string
}

/** Typed outcome returned when requesting, confirming, or cancelling a mode switch. */
export interface ModeSwitchRequestResult {
	status: ModeSwitchRequestStatus
	operationId?: string
	error?: string
}
