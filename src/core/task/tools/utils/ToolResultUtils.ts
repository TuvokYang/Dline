import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@/integrations/misc/extract-text"
import { ClineAsk } from "@/shared/ExtensionMessage"
import type { ClineUserToolResultContentBlock } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"
import { sayFeedbackOnce } from "./UserFeedbackUtils"

/**
 * Utility functions for handling tool results and feedback
 */
interface PendingToolFeedbackBlock {
	type: "tool_feedback"
	content: ToolResponse
}

export class ToolResultUtils {
	// biome-ignore lint/complexity/noStaticOnlyClass: utility class with static methods only
	private constructor() {}

	/**
	 * Check whether a user message block is pending approval feedback.
	 *
	 * @param block Candidate user message content block.
	 * @returns True when the block should be merged into the next tool_result.
	 */
	private static isPendingFeedback(block: unknown): block is PendingToolFeedbackBlock {
		return Boolean(block && typeof block === "object" && (block as PendingToolFeedbackBlock).type === "tool_feedback")
	}

	/**
	 * Drain pending approval feedback before the current tool result is pushed.
	 *
	 * @param userMessageContent Mutable next-user-message content list.
	 * @returns Feedback content blocks to append inside the tool_result.
	 */
	private static drainPendingFeedback(userMessageContent: any[]): ToolResponse[] {
		const pendingFeedback: ToolResponse[] = []
		for (let i = userMessageContent.length - 1; i >= 0; i--) {
			const block = userMessageContent[i]
			if (ToolResultUtils.isPendingFeedback(block)) {
				pendingFeedback.unshift(block.content)
				userMessageContent.splice(i, 1)
			}
		}
		return pendingFeedback
	}

	/**
	 * Merge tool execution result with approval feedback content.
	 *
	 * @param resultText Main tool result text.
	 * @param feedbackContent Pending approval feedback content blocks.
	 * @returns A string result when no feedback exists, otherwise content blocks.
	 */
	private static mergeTextResult(resultText: string, feedbackContent: ToolResponse[]): ToolResponse {
		if (feedbackContent.length === 0) {
			return resultText
		}
		return [{ type: "text", text: resultText }, ...ToolResultUtils.flattenFeedback(feedbackContent)]
	}

	/**
	 * Merge structured tool result content with approval feedback content.
	 *
	 * @param content Structured tool result content.
	 * @param feedbackContent Pending approval feedback content blocks.
	 * @returns Structured content with feedback appended.
	 */
	private static mergeStructuredResult(content: ToolResponse, feedbackContent: ToolResponse[]): ToolResponse {
		if (feedbackContent.length === 0) {
			return content
		}
		const baseContent = Array.isArray(content) ? content : ([{ type: "text", text: String(content) }] as const)
		return [...baseContent, ...ToolResultUtils.flattenFeedback(feedbackContent)]
	}

	/**
	 * Flatten formatted feedback into tool_result-compatible content blocks.
	 *
	 * @param feedbackContent Feedback entries captured from approval UI.
	 * @returns Flattened text/image content blocks.
	 */
	private static flattenFeedback(feedbackContent: ToolResponse[]): any[] {
		return feedbackContent.flatMap((content) =>
			Array.isArray(content) ? content : ([{ type: "text", text: content }] as const),
		)
	}

	/**
	 * Create a canonical native tool result without consulting runtime maps.
	 *
	 * @param content Tool result content.
	 * @param block Native tool use carrying provider and Dline identities.
	 * @param itemId New logical identity allocated for this result block.
	 * @returns Canonical structured tool result.
	 */
	static createResult(content: ToolResponse, block: ToolUse, itemId: string): ClineUserToolResultContentBlock {
		if (!block.function_id || !block.dline_tid) {
			throw new Error(`Native tool result is missing canonical identity: tool=${block.name}`)
		}
		return {
			type: "tool_result",
			tool_use_id: block.function_id,
			call_id: block.function_id,
			item_id: itemId,
			function_id: block.function_id,
			dline_tid: block.dline_tid,
			content: typeof content === "string" ? [{ type: "text", text: content }] : content,
		}
	}

	/**
	 * Push tool result to user message content with proper formatting
	 */
	static pushToolResult(
		content: ToolResponse,
		block: ToolUse,
		userMessageContent: any[],
		toolDescription: (block: ToolUse) => string,
		coordinator: ToolExecutorCoordinator | undefined,
		nextItemId: () => string,
	): void {
		const pendingFeedback = ToolResultUtils.drainPendingFeedback(userMessageContent)
		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Try to get description from coordinator first, otherwise use the provided function
			const description = coordinator
				? (() => {
						const handler = coordinator.getHandler(block.name)
						return handler ? handler.getDescription(block) : toolDescription(block)
					})()
				: toolDescription(block)

			// Replace existing tool_result for the same tool_use_id with the
			// latest result. When a tool is re-executed (e.g. partial→reRender
			// lifecycle), the newer error message (e.g. "Document not initialized")
			// replaces the older one (e.g. "SEARCH block not found"). The final
			// result is what the AI sees, and ensureToolResultsFollowToolUse
			// deduplicates by tool_use_id before sending to the API.
			const existingIndex = userMessageContent.findIndex(
				(item: any) => item.type === "tool_result" && item.function_id === block.function_id,
			)
			const mergedContent = ToolResultUtils.mergeTextResult(`${description} Result:\n${resultText}`, pendingFeedback)
			if (existingIndex !== -1) {
				const existingItemId = userMessageContent[existingIndex]?.item_id
				const newBlock = ToolResultUtils.createResult(mergedContent, block, existingItemId ?? nextItemId())
				userMessageContent[existingIndex] = newBlock
				Logger.warn(`ToolResultUtils: Replaced existing tool_result for function_id ${block.function_id}`)
				return
			}

			userMessageContent.push(ToolResultUtils.createResult(mergedContent, block, nextItemId()))
		} else {
			// For complex content (arrays with text/image blocks), pass it through directly
			// The content array should already be properly formatted with type, text, source, etc.
			const mergedContent = ToolResultUtils.mergeStructuredResult(content, pendingFeedback)
			userMessageContent.push(ToolResultUtils.createResult(mergedContent, block, nextItemId()))
		}
	}

	/**
	 * Push additional tool feedback from user to message content
	 */
	static pushAdditionalToolFeedback(
		userMessageContent: any[],
		feedback?: string,
		images?: string[],
		fileContentString?: string,
	): void {
		// Check if we have any meaningful content to add
		const hasMeaningfulFeedback = feedback && feedback.trim() !== ""
		const hasImages = images && images.length > 0
		const hasMeaningfulFileContent = fileContentString && fileContentString.trim() !== ""

		// Only proceed if we have at least one meaningful piece of content
		if (!hasMeaningfulFeedback && !hasImages && !hasMeaningfulFileContent) {
			return
		}

		// Build the feedback text only if we have meaningful feedback
		const feedbackText = hasMeaningfulFeedback
			? `The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
			: "The user provided additional content:"

		const content = formatResponse.toolResult(feedbackText, images, hasMeaningfulFileContent ? fileContentString : undefined)
		userMessageContent.push({ type: "tool_feedback", content } satisfies PendingToolFeedbackBlock)
	}

	/**
	 * Handles tool approval flow and processes any user feedback
	 */
	static async askApprovalAndPushFeedback(type: ClineAsk, completeMessage: string, config: TaskConfig, existingTs?: number) {
		if (config.isSubagentExecution) {
			return true
		}

		const { response, text, images, files } = await config.callbacks.ask(
			type,
			completeMessage,
			false,
			existingTs !== undefined ? { existingTs } : undefined,
		)

		if (text || (images && images.length > 0) || (files && files.length > 0)) {
			let fileContentString = ""
			if (files && files.length > 0) {
				fileContentString = await processFilesIntoText(files)
			}

			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContentString)
			await sayFeedbackOnce(config, response, text, images, files)
		}

		if (response !== "yesButtonClicked") {
			// Only explicit approve button click runs the tool.
			// "noButtonClicked" = reject, "messageResponse" = typed text without clicking.
			config.taskController.rejectActiveBlock() // Prevent further tool uses in this message
			return false
		}
		// "yesButtonClicked" — explicit approval; feedback has already been saved above.
		return true
	}
}
