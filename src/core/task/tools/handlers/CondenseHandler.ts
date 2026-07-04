import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ClineAsk } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class CondenseHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.CONDENSE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return getPrompt("toolHandlers", "condenseMissingContext")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: getPrompt("toolHandlers", "condenseNotificationSubtitle"),
				message: getPrompt("toolHandlers", "condenseNotificationMessage", { context }),
			})
		}

		// Ask user for response
		const {
			text,
			images,
			files: condenseFiles,
		} = await config.callbacks.ask("condense", context, false, { existingTs: block.ts })

		// If the user provided a response, treat it as feedback
		if (text || (images && images.length > 0) || (condenseFiles && condenseFiles.length > 0)) {
			let fileContentString = ""
			if (condenseFiles && condenseFiles.length > 0) {
				fileContentString = await processFilesIntoText(condenseFiles)
			}

			await config.callbacks.say("user_feedback", text ?? "", images, condenseFiles)
			return formatResponse.toolResult(
				getPrompt("toolHandlers", "condenseFeedbackResult", { text: text ?? "" }),
				images,
				fileContentString,
			)
		}
		// If no response, the user accepted the condensed version
		const apiConversationHistory = config.messageState.apiConversationHistory
		const lastMessage = apiConversationHistory[apiConversationHistory.length - 1]
		const summaryAlreadyAppended = lastMessage && lastMessage.role === "assistant"
		const keepStrategy = summaryAlreadyAppended ? "lastTwo" : "none"

		// clear the context history at this point in time
		config.taskState.conversationHistoryDeletedRange = config.services.contextManager.getNextTruncationRange(
			apiConversationHistory,
			config.taskState.conversationHistoryDeletedRange,
			keepStrategy,
		)
		await config.messageState.updateTaskHistory()
		await config.services.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(config.taskId),
			apiConversationHistory,
		)

		return formatResponse.toolResult(formatResponse.condense())
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = block.params.context || ""
		const cleanedContext = uiHelpers.removeClosingTag(block, "context", context)

		const existingTs = block.ts
		uiHelpers
			.ask("condense" as ClineAsk, cleanedContext, true, {
				existingTs,
			})
			.catch(() => {})
	}
}
