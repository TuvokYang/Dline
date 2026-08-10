import { hasManualCompactionCommand } from "@core/slash-commands"
import type { ClineContent } from "@/shared/messages/content"
import { shouldCompactProjectedUsage } from "./context-window-utils"

const TOKEN_ESTIMATE_CHARS = 4

export interface CurrentTurnCompactionInput {
	triggerTokens: number
	previousTokens: number
	userContent: ClineContent[]
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
export function estimateCurrentTokens(userContent: ClineContent[]): number {
	const textLength = userContent.reduce((total, block) => total + getBlockText(block).length, 0)
	return Math.ceil(textLength / TOKEN_ESTIMATE_CHARS)
}

/**
 * Detect whether the pending user content contains any tool result.
 *
 * @param userContent Content blocks that would be appended as the next user message.
 * @returns True when a tool_result block is present in the pending content.
 */
export function hasToolResult(userContent: ClineContent[]): boolean {
	return userContent.some((block) => block.type === "tool_result")
}

/**
 * Detect an explicit manual compaction command in current-turn text, including nested tool-result feedback.
 *
 * @param userContent Pending current-turn content.
 * @returns True when user-authored tagged content requests /compact or /smol.
 */
export function hasManualCompactionIntent(
	userContent: ClineContent[],
	isTrustedUserFeedback: (block: Extract<ClineContent, { type: "tool_result" }>) => boolean = () => false,
): boolean {
	return userContent.some((block) => {
		if (block.type === "text") {
			return hasManualCompactionCommand(block.text)
		}
		if (block.type !== "tool_result" || !isTrustedUserFeedback(block)) {
			return false
		}
		if (typeof block.content === "string") {
			return hasManualCompactionCommand(block.content)
		}
		return block.content?.some((contentBlock) =>
			contentBlock.type === "text" ? hasManualCompactionCommand(contentBlock.text) : false,
		)
	})
}

/**
 * Preserve user-authored text in the explicit compaction request while tool results stay deferred.
 *
 * @param userContent Deferred current-turn content.
 * @returns Non-tool-result blocks that the summary must account for.
 */
export function getCompactionUserText(userContent: ClineContent[]): ClineContent[] {
	return userContent.filter((block) => block.type !== "tool_result")
}

/**
 * Decide whether the current tool-result turn should be deferred while older context is summarized first.
 *
 * @param input Resolved compaction trigger, previous request usage, and pending current-turn content.
 * @returns True when pending tool results would push the next request over the compaction trigger.
 */
export function shouldDeferCurrentTurn(input: CurrentTurnCompactionInput): boolean {
	if (!hasToolResult(input.userContent)) {
		return false
	}

	if (shouldCompactProjectedUsage(input.previousTokens, input.triggerTokens)) {
		return true
	}

	return shouldCompactProjectedUsage(input.previousTokens + estimateCurrentTokens(input.userContent), input.triggerTokens)
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
 * Project the internal summarize_task result after its matching function call has been truncated.
 *
 * @param userContent Pending content produced by the completed compaction turn.
 * @returns User content that no longer contains orphaned tool results.
 */
export function projectCompletedCompactionResult(userContent: ClineContent[]): ClineContent[] {
	return userContent.flatMap((block) => {
		if (block.type !== "tool_result") {
			return [block]
		}

		const text = getBlockText(block)
		return text.length > 0 ? [{ type: "text" as const, text }] : []
	})
}

/**
 * Extract text from supported Anthropic content block shapes.
 *
 * @param block Content block to inspect.
 * @returns Extracted text, or an empty string for non-text blocks.
 */
function getBlockText(block: ClineContent): string {
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
