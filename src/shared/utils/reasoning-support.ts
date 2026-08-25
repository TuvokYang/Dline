import { normalizeOpenaiReasoningEffort, type OpenaiReasoningEffort } from "../storage/types"

export type ClaudeAdaptiveThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max"

export interface ClaudeOpusAdaptiveThinkingSettings {
	enabled: boolean
	effort?: ClaudeAdaptiveThinkingEffort
}

export const DEEPSEEK_REASONING_EFFORT_OPTIONS = ["low", "high", "max"] as const

export type DeepSeekReasoningEffort = (typeof DEEPSEEK_REASONING_EFFORT_OPTIONS)[number]

/** Identify DeepSeek model IDs across native and OpenAI-compatible providers. */
export function isDeepSeekReasoningModel(modelId?: string): boolean {
	return modelId?.toLowerCase().includes("deepseek") === true
}

export interface DeepSeekAdaptiveThinkingSettings {
	enabled: boolean
	effort?: DeepSeekReasoningEffort
}

export function isClaudeOpusAdaptiveThinkingModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	// Fable 5, Opus 5, Opus 4.6/4.7/4.8, and Sonnet 5 support adaptive thinking
	if (id.includes("claude-fable-5") || id.includes("claude-opus-5") || id.includes("claude-sonnet-5")) {
		return true
	}
	const adaptiveVersions = ["4-6", "4.6", "4-7", "4.7", "4-8", "4.8"]
	return adaptiveVersions.some((version) => id.includes(`claude-opus-${version}`) || id.includes(`claude-${version}-opus`))
}

export function resolveClaudeOpusAdaptiveThinking(
	reasoningEffort?: string,
	legacyThinkingBudgetTokens?: number,
): ClaudeOpusAdaptiveThinkingSettings {
	if (reasoningEffort) {
		const effort = normalizeOpenaiReasoningEffort(reasoningEffort)
		if (effort === "none") {
			return { enabled: false }
		}
		if (effort === "minimal") {
			return { enabled: true, effort: "low" }
		}
		if (effort === "ultra") {
			return { enabled: true, effort: "max" }
		}
		return { enabled: true, effort }
	}

	return legacyThinkingBudgetTokens && legacyThinkingBudgetTokens > 0 ? { enabled: true, effort: "high" } : { enabled: false }
}

/**
 * Resolves adaptive thinking settings for DeepSeek V4 models.
 *
 * DeepSeek V4 supports thinking mode: the model outputs a chain-of-thought
 * (reasoning_content) before the final answer to improve accuracy.
 *
 * Behavior:
 * 1. Default thinking is enabled.
 * 2. Default effort is "high" for standard requests; for complex agent-style
 *    requests (e.g., Claude Code, OpenCode), effort is automatically set to "max".
 * 3. The native "low", "high", and "max" values are preserved; legacy higher
 *    aliases continue to map to "max", while unknown values fall back to "high".
 */
export function resolveDeepSeekAdaptiveThinking(reasoningEffort?: string): DeepSeekAdaptiveThinkingSettings {
	if (!reasoningEffort) {
		return { enabled: true, effort: "high" }
	}

	const effort = reasoningEffort.toLowerCase() as OpenaiReasoningEffort
	if (effort === "none") {
		return { enabled: false }
	}
	if (effort === "max" || effort === "xhigh" || effort === "ultra") {
		return { enabled: true, effort: "max" }
	}
	if (effort === "low" || effort === "high") {
		return { enabled: true, effort }
	}
	return { enabled: true, effort: "high" }
}

export function supportsReasoningEffortForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	return (
		id.includes("gemini") ||
		id.includes("gpt") ||
		id.startsWith("openai/o") ||
		id.includes("/o") ||
		id.startsWith("o") ||
		id.includes("grok")
	)
}
