import type { ClineApiReqInfo } from "@shared/ExtensionMessage"
import { computeCompactTrigger, computeSummarizeBudget } from "./context-window-utils"

/** Context pressure inputs required to evaluate one mode-switch request. */
export interface ModeSwitchPressureInput {
	sourceProfile: string
	targetProfile: string
	sourceWindow: number
	targetWindow: number
	currentTokens: number
}

/** Pure mode-switch pressure decision. */
export type ModeSwitchPressureDecision = { kind: "switch" } | { kind: "confirm"; triggerTokens: number }

/**
 * Compute canonical context occupancy from persisted request usage.
 *
 * @param info Persisted API request metrics.
 * @returns Canonical context occupancy in tokens.
 */
export function getContextTokens(info: ClineApiReqInfo): number {
	if (typeof info.contextTokens === "number" && Number.isFinite(info.contextTokens) && info.contextTokens >= 0) {
		return info.contextTokens
	}
	return (info.tokensIn || 0) + (info.tokensOut || 0) + (info.cacheWrites || 0) + (info.cacheReads || 0)
}

/**
 * Parse canonical context occupancy from a serialized API request message.
 *
 * @param text Serialized api_req_started metadata.
 * @returns Canonical context occupancy, or zero when metadata is unavailable.
 */
export function readContextTokens(text?: string): number {
	if (!text) {
		return 0
	}
	try {
		return getContextTokens(JSON.parse(text) as ClineApiReqInfo)
	} catch {
		return 0
	}
}

/**
 * Decide whether a mode switch is safe or requires compact confirmation.
 *
 * @param input Source, target, and current context pressure.
 * @returns A direct-switch or confirmation-required decision.
 */
export function decideModeSwitch(input: ModeSwitchPressureInput): ModeSwitchPressureDecision {
	if (input.sourceProfile === input.targetProfile || input.targetWindow >= input.sourceWindow) {
		return { kind: "switch" }
	}
	const triggerTokens = computeCompactTrigger(input.targetWindow, computeSummarizeBudget())
	return input.currentTokens >= triggerTokens ? { kind: "confirm", triggerTokens } : { kind: "switch" }
}
