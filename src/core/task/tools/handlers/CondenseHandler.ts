import type { ToolUse } from "@core/assistant-message"
import { getPrompt, renderPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ClineAsk } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import { interactionId, interactionTurnId, type TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { NO_TOOL_RESULT } from "../utils/ToolResultUtils"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

export class CondenseHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.CONDENSE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context
		const blockName = String(block.name)
		const isAuto = blockName === "auto-condense"

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return getPrompt("toolHandlers", "condenseMissingContext")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Auto-condense mode: skip user interaction
		if (isAuto) {
			return this.executeAutoCompact(config, block)
		}

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: getPrompt("toolHandlers", "condenseNotificationSubtitle"),
				message: renderPrompt("toolHandlers", "condenseNotificationMessage", { CONTEXT: context }),
			})
		}

		const outcome = await config.interactions.open({
			turnId: interactionTurnId(block),
			interactionId: interactionId(block),
			kind: "condense",
			presentation: context,
			existingTs: block.ts,
		})
		const text = outcome.draft?.text
		const images = outcome.draft?.images
		const condenseFiles = outcome.draft?.files

		if (outcome.actionId === "reject") {
			let fileContentString = ""
			if (condenseFiles && condenseFiles.length > 0) {
				fileContentString = await processFilesIntoText(condenseFiles)
			}

			if (text || (images && images.length > 0) || (condenseFiles && condenseFiles.length > 0)) {
				await sayFeedbackOnce(config, "messageResponse", text, images, condenseFiles)
			}
			return formatResponse.toolResult(
				renderPrompt("toolHandlers", "condenseFeedbackResult", {
					TEXT: text?.trim() || "No additional written feedback was provided.",
				}),
				images,
				fileContentString,
			)
		}

		if (outcome.actionId !== "confirm_utility") {
			throw new Error(`Unsupported condense interaction action: ${outcome.actionId}`)
		}

		// The user accepted the condensed version.
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
		await config.messageState.addToApiConversationHistory({
			role: "user",
			content: [{ type: "text", text: context }],
			ts: Date.now(),
		})

		// The truncation above removed the condense tool_use turn from history.
		// Returning a tool_result here would orphan it (the pairing tool_use is
		// gone), so signal the executor to skip the result entirely.
		return NO_TOOL_RESULT
	}

	/**
	 * Execute auto-compact mode: skip ask(), directly truncate context.
	 * Also parses "Required Files" from the AI summary and auto-reads them.
	 * @param config Task configuration with callbacks and services.
	 * @param block The tool-use block from AI.
	 * @returns Tool response confirming compaction, with appended file contents if any.
	 */
	private async executeAutoCompact(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context
		const apiConversationHistory = config.messageState.apiConversationHistory
		const keepStrategy = "none"

		// Parse "Required Files" section from the summary context and auto-read files
		let fileContents = ""
		if (context) {
			fileContents = await this.readRequiredFiles(config, context)
		}

		// Truncate conversation history
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

		const result = formatResponse.toolResult(formatResponse.condense() + fileContents)
		return result
	}

	/**
	 * Parse "Required Files" section from summary context and auto-read file contents.
	 * Matches both "10. Optional Required Files:" and "10. Required Files:" formats.
	 * @param config Task configuration with callbacks and services.
	 * @param context The summary context string from AI.
	 * @returns Formatted file content string, or empty string if no files matched.
	 */
	private async readRequiredFiles(config: TaskConfig, context: string): Promise<string> {
		const loadedFilePaths: string[] = []
		let result = ""
		// Match section 10 (Required Files) — handles both "Optional Required Files" and "Required Files"
		const filePathRegex = /10\.\s*(?:Optional\s+)?Required Files:\s*((?:\n\s*-\s*.+)+)/m
		const match = context.match(filePathRegex)

		if (!match) {
			return ""
		}

		const fileListText = match[1]
		const filePaths: string[] = []
		const lines = fileListText.split("\n")

		for (const line of lines) {
			const pathMatch = line.match(/^\s*-\s*(.+)$/)
			if (pathMatch) {
				filePaths.push(pathMatch[1].trim())
			}
		}

		let filesProcessed = 0
		let filesLoaded = 0
		let totalChars = 0
		const MAX_FILES_LOADED = 8
		const MAX_FILES_PROCESSED = 10
		const MAX_CHARS = 100_000
		const loadedFiles = new Set<string>()

		for (const relPath of filePaths) {
			const normalizedPath = relPath.toLowerCase()
			if (loadedFiles.has(normalizedPath)) {
				continue
			}
			loadedFiles.add(normalizedPath)

			filesProcessed++
			if (filesProcessed > MAX_FILES_PROCESSED) {
				break
			}

			try {
				// Resolve path (handles multi-root workspaces)
				const pathResult = resolveWorkspacePath(config, relPath, "CondenseHandler.autoCompact")
				const { absolutePath, displayPath } =
					typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath } : pathResult

				// Read file content
				const fileContent = await extractFileContent(absolutePath, false)

				if (totalChars + fileContent.text.length > MAX_CHARS) {
					break
				}

				result += `\n\n<file_content path="${displayPath}">\n${fileContent.text}\n</file_content>`
				loadedFilePaths.push(displayPath)

				totalChars += fileContent.text.length
				filesLoaded++

				if (filesLoaded >= MAX_FILES_LOADED) {
					break
				}
			} catch (_error) {
				// File read failed — skip and continue with other files
			}
		}

		if (result) {
			const fileMentionString = `${loadedFilePaths.map((p) => `'${p}'`).join(", ")} (see below for file content)`
			result =
				`\n\nThe following files were automatically read based on the files listed in the Required Files section: ${fileMentionString}. These are the latest versions of these files - you should reference them directly and not re-read them:` +
				result
		}

		return result
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Auto-condense partials don't need UI interaction
		if (String(block.name) === "auto-condense") {
			return
		}

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
