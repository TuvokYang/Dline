import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@/integrations/misc/extract-text"
import { ClineAsk } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

/**
 * Utility functions for handling tool results and feedback
 */
export class ToolResultUtils {
	// biome-ignore lint/complexity/noStaticOnlyClass: utility class with static methods only
	private constructor() {}

	/**
	 * Push tool result to user message content with proper formatting
	 */
	static pushToolResult(
		content: ToolResponse,
		block: ToolUse,
		userMessageContent: any[],
		toolDescription: (block: ToolUse) => string,
		coordinator?: ToolExecutorCoordinator,
		toolUseIdMap?: Map<string, string>,
	): void {
		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Try to get description from coordinator first, otherwise use the provided function
			const description = coordinator
				? (() => {
						const handler = coordinator.getHandler(block.name)
						return handler ? handler.getDescription(block) : toolDescription(block)
					})()
				: toolDescription(block)

			// Get tool_use_id from map using call_id; no fallback — if the map
			// has no entry for this call_id then there is no valid API tool_use id
			// and the result will be downgraded to text in createToolResultBlock.
			const toolUseId = toolUseIdMap?.get(block.call_id || "")
			Logger.debug(
				`pushToolResult: tool=${block.name} call_id=${block.call_id} tool_use_id=${toolUseId} mapSize=${toolUseIdMap?.size ?? 0}`,
			)

			// Replace existing tool_result for the same tool_use_id with the
			// latest result. When a tool is re-executed (e.g. partial→reRender
			// lifecycle), the newer error message (e.g. "Document not initialized")
			// replaces the older one (e.g. "SEARCH block not found"). The final
			// result is what the AI sees, and ensureToolResultsFollowToolUse
			// deduplicates by tool_use_id before sending to the API.
			const existingIndex = userMessageContent.findIndex(
				(item: any) => item.type === "tool_result" && item.tool_use_id === toolUseId,
			)
			if (existingIndex !== -1) {
				const newBlock = ToolResultUtils.createToolResultBlock(
					`${description} Result:\n${resultText}`,
					toolUseId,
					block.call_id,
				)
				userMessageContent[existingIndex] = newBlock
				Logger.warn(`ToolResultUtils: Replaced existing tool_result for tool_use_id ${toolUseId}`)
				return
			}

			// Create ToolResultBlockParam with description and result
			userMessageContent.push(
				ToolResultUtils.createToolResultBlock(`${description} Result:\n${resultText}`, toolUseId, block.call_id),
			)
		} else {
			// For complex content (arrays with text/image blocks), pass it through directly
			// The content array should already be properly formatted with type, text, source, etc.
			const toolUseId = toolUseIdMap?.get(block.call_id || "")

			// If no valid tool_use_id and content is an array, spread it directly
			if (!toolUseId && Array.isArray(content)) {
				userMessageContent.push(...content)
			} else {
				userMessageContent.push(ToolResultUtils.createToolResultBlock(content, toolUseId, block.call_id))
			}
		}
	}

	private static createToolResultBlock(content: ToolResponse, id?: string, call_id?: string) {
		// Without a valid API tool_use id, we cannot produce a tool_result
		// block. Downgrade to plain text so the result is still visible to
		// the model but does not break the tool_use/tool_result pairing
		// required by the API.
		if (!id) {
			return {
				type: "text",
				text: typeof content === "string" ? content : JSON.stringify(content, null, 2),
			}
		}

		// For tool_result blocks, content is always an array of content blocks
		// to maintain consistent format for KV cache matching across all code paths.
		// When content is a string, wrap it as [{type:"text", text:...}].
		// When content is already an array, pass it through directly.
		return {
			type: "tool_result",
			tool_use_id: id,
			call_id: call_id,
			content: typeof content === "string" ? [{ type: "text", text: content }] : content,
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
		if (typeof content === "string") {
			userMessageContent.push({
				type: "text",
				text: content,
			})
		} else {
			userMessageContent.push(...content)
		}
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
			await config.callbacks.say("user_feedback", text, images, files)
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
