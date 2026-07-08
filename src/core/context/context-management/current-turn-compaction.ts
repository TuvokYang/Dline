import type { Anthropic } from "@anthropic-ai/sdk"
import { computeCompactTrigger, computeSummarizeBudget } from "./context-window-utils"

const TOKEN_ESTIMATE_CHARS = 4

export interface CurrentTurnCompactionInput {
	contextWindow: number
	previousTokens: number
	userContent: Anthropic.Messages.ContentBlockParam[]
}

export interface DeferredTurnRestoreInput {
	hasDeferredTurn: boolean
	didCompleteSummarization: boolean
}

/**
 * Estimate token usage for current-turn content before it is sent.
 *
 * @param userContent Content blocks that would be appended as the next user message.
 * @returns Conservative token estimate based on text length.
 */
export function estimateCurrentTokens(userContent: Anthropic.Messages.ContentBlockParam[]): number {
	const textLength = userContent.reduce((total, block) => total + getBlockText(block).length, 0)
	return Math.ceil(textLength / TOKEN_ESTIMATE_CHARS)
}

/**
 * Detect whether the pending user content contains any tool result.
 *
 * @param userContent Content blocks that would be appended as the next user message.
 * @returns True when a tool_result block is present in the pending content.
 */
export function hasToolResult(userContent: Anthropic.Messages.ContentBlockParam[]): boolean {
	return userContent.some((block) => block.type === "tool_result")
}

/**
 * Decide whether the current tool-result turn should be deferred while older context is summarized first.
 *
 * @param input Context-window size, previous request usage, and pending current-turn content.
 * @returns True when pending tool results would push the next request over the compaction trigger.
 */
export function shouldDeferCurrentTurn(input: CurrentTurnCompactionInput): boolean {
	if (!hasToolResult(input.userContent)) {
		return false
	}

	const triggerTokens = computeCompactTrigger(input.contextWindow, computeSummarizeBudget())
	if (input.previousTokens >= triggerTokens) {
		return true
	}

	return input.previousTokens + estimateCurrentTokens(input.userContent) >= triggerTokens
}

/**
 * Decide whether a cached current turn can be restored.
 *
 * @param input Deferred-turn and summarization completion state.
 * @returns True only when a deferred turn exists and summarize_task has completed.
 */
export function shouldRestoreDeferredTurn(input: DeferredTurnRestoreInput): boolean {
	return input.hasDeferredTurn && input.didCompleteSummarization
}

/**
 * Extract text from supported Anthropic content block shapes.
 *
 * @param block Content block to inspect.
 * @returns Extracted text, or an empty string for non-text blocks.
 */
function getBlockText(block: Anthropic.Messages.ContentBlockParam): string {
	if (block.type === "text") {
		return block.text
	}

	if (block.type === "tool_result") {
		if (typeof block.content === "string") {
			return block.content
		}

		if (Array.isArray(block.content)) {
			return block.content.map((contentBlock) => (contentBlock.type === "text" ? contentBlock.text : "")).join("\n")
		}
	}

	return ""
}
