import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHookModelContext } from "@core/hooks/hook-model-context"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import * as NotificationHook from "@core/hooks/notification-hook"
import { getPrompt, renderPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool } from "@shared/tools"
import { commitCompletion } from "../../completion/CompletionCommit"
import type { ToolResponse } from "../../index"
import type { InteractionOutcome } from "../../interaction/InteractionCoordinator"
import { showNotificationForApproval } from "../../utils"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import { interactionId, interactionTurnId, type TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

const TASK_PREVIEW_MAX_CHARS = 8000

function getInitialTaskPreview(config: TaskConfig): string | undefined {
	const firstTaskMessage = config.messageState.clineMessages.find((message) => message.say === "task")?.text?.trim()
	if (!firstTaskMessage) {
		return undefined
	}
	if (firstTaskMessage.length <= TASK_PREVIEW_MAX_CHARS) {
		return firstTaskMessage
	}
	return `${firstTaskMessage.slice(0, TASK_PREVIEW_MAX_CHARS)}\n...[truncated]`
}

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 */
	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Completion remains provisional until optional command execution and all commit prerequisites succeed.
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Double-check completion: reject attempt_completion calls that haven't been re-verified
		if (config.doubleCheckCompletionEnabled && !config.taskState.doubleCheckCompletionPending) {
			config.taskState.doubleCheckCompletionPending = true
			// Use block.ts to remove the partial completion_result from handlePartialBlock
			if (block.ts !== undefined) {
				await config.callbacks.say("completion_result", "", undefined, undefined, false, block.ts)
			}

			const taskPreview = getInitialTaskPreview(config)
			const taskSection = taskPreview ? `\n\n<initial_task>\n${taskPreview}\n</initial_task>` : ""

			return formatResponse.toolError(
				renderPrompt("toolHandlers", "doubleCheckVerification", { TASK_SECTION: taskSection }),
			)
		}
		// Reset so the next attempt_completion pair triggers double-check again
		config.taskState.doubleCheckCompletionPending = false

		// Run PreToolUse hook before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: getPrompt("toolHandlers", "attemptCompletionNotificationSubtitle"),
				message: result.replace(/\n/g, " "),
			})
		}

		if (command) {
			// Check if command should be auto-approved
			// attempt_completion commands don't have requires_approval param, so we treat them as safe commands
			const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(ClineDefaultTool.BASH)
			const autoApproveSafe = Array.isArray(autoApproveResult) ? autoApproveResult[0] : autoApproveResult

			if (autoApproveSafe) {
				// Auto-approve flow - show command as 'say' instead of 'ask'
				// Command is a separate UI message from completion_result; do NOT reuse block.ts.
				const commandTs = await config.callbacks.say("command", command, undefined, undefined, false)
				return this.executeApprovedCommandAndComplete(config, block, command, commandTs)
			}

			// Manual approval flow - need to ask for approval
			showNotificationForApproval(
				`Dline wants to execute a command: ${command}`,
				config.autoApprovalSettings.enableNotifications,
			)

			const approval = await config.interactions.open({
				turnId: interactionTurnId(block),
				interactionId: interactionId(block),
				kind: "command_approval",
				presentation: command,
			})
			return this.continueCommandApproval(config, block, approval)
		}

		return this.commitAndPresentCompletion(config, block)
	}

	/** Continue only the side effects after an exact attempt_completion command decision. */
	async continueCommandApproval(
		config: TaskConfig,
		block: ToolUse,
		approval: InteractionOutcome,
		commandTs?: number,
	): Promise<ToolResponse> {
		const result = block.params.result
		const command = block.params.command
		if (!result || !command || (approval.actionId !== "approve" && approval.actionId !== "reject")) {
			throw new Error("Invalid attempt_completion command approval continuation")
		}

		const text = approval.draft?.text
		const images = approval.draft?.images
		const files = approval.draft?.files
		if (text || images?.length || files?.length) {
			const fileContent = files?.length ? await processFilesIntoText(files) : ""
			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContent)
			await sayFeedbackOnce(
				config,
				approval.actionId === "approve" ? "yesButtonClicked" : "noButtonClicked",
				text,
				images,
				files,
			)
		}
		if (approval.actionId === "reject") {
			config.taskController.rejectActiveBlock()
			return formatResponse.toolDenied()
		}

		return this.executeApprovedCommandAndComplete(config, block, command, commandTs)
	}

	private findCommandMessageTs(config: TaskConfig): number | undefined {
		for (let i = config.messageState.clineMessages.length - 1; i >= 0; i--) {
			const message = config.messageState.clineMessages[i] as any
			if ((message.ask === "command" || message.say === "command") && message.commandStatus !== "skipped") {
				return message.ts
			}
		}
		return undefined
	}

	private async executeApprovedCommandAndComplete(
		config: TaskConfig,
		block: ToolUse,
		command: string,
		commandTs?: number,
	): Promise<ToolResponse> {
		const exactCommandTs = commandTs ?? this.findCommandMessageTs(config)
		const commandOutcome = await config.callbacks.executeCommandTool(command, undefined, {
			commandTs: exactCommandTs,
		})

		if (commandOutcome.userRejected) {
			config.taskController.rejectActiveBlock()
			return commandOutcome.result
		}
		const commandSucceeded = commandOutcome.completed && commandOutcome.exitCode === 0 && commandOutcome.signal == null
		if (!commandSucceeded) {
			return commandOutcome.result
		}
		return this.commitAndPresentCompletion(config, block, commandOutcome.result)
	}

	private async commitAndPresentCompletion(
		config: TaskConfig,
		block: ToolUse,
		commandResult?: ToolResponse,
	): Promise<ToolResponse> {
		const result = block.params.result
		if (!result) throw new Error("Invalid attempt_completion continuation result")

		await commitCompletion({
			publishResult: () => config.callbacks.say("completion_result", result, undefined, undefined, false, block.ts),
			saveCheckpoint: (completionMessageTs) => config.callbacks.saveCheckpoint(true, completionMessageTs),
			markWorkspaceChanges: () => this.addNewChangesFlagToLastCompletionResultMessage(config),
			captureTelemetry: () => telemetryService.captureTaskCompleted(config.ulid ?? "", getTaskCompletionTelemetry(config)),
			updateFocusChain: async () => {
				if (!block.partial && config.focusChainSettings.enabled) {
					await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
				}
			},
		})

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		// in case last command was interactive and in partial state, the UI is expecting an ask response. This ends the command ask response, freeing up the UI to proceed with the completion ask.
		if (config.messageState.clineMessages.at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		// Run TaskComplete hook BEFORE presenting the "Start New Task" button
		// At this point we know: task is complete, checkpoint saved, result shown to user
		await this.runTaskCompleteHook(config, block)
		await NotificationHook.emitTaskCompleteNotification(
			{
				messageStateHandler: config.messageState,
				taskId: config.taskId,
				hooksEnabled: getHooksEnabledSafe(config.services.stateManager.getGlobalSettingsKey("hooksEnabled")),
				model: getHookModelContext(config.api, config.services.stateManager),
			},
			{ message: result },
		)

		const outcome = await config.interactions.complete({
			turnId: interactionTurnId(block),
			interactionId: interactionId(block),
			completionId: interactionId(block),
			presentation: result,
			existingTs: block.ts,
		})
		return this.continueInteraction(config, block, outcome, commandResult)
	}

	private async addNewChangesFlagToLastCompletionResultMessage(config: TaskConfig): Promise<void> {
		const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
		const clineMessages = config.messageState.clineMessages
		const lastCompletionResultMessageIndex = findLastIndex(
			clineMessages,
			(message: any) => message.say === "completion_result",
		)
		const lastCompletionResultMessage =
			lastCompletionResultMessageIndex !== -1 ? clineMessages[lastCompletionResultMessageIndex] : undefined
		if (
			lastCompletionResultMessage &&
			lastCompletionResultMessageIndex !== -1 &&
			hasNewChanges &&
			!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
		) {
			await config.messageState.updateClineMessage(lastCompletionResultMessageIndex, {
				text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
			})
		}
	}

	/** Consume completion feedback without replaying command execution or completion commit. */
	async continueInteraction(
		config: TaskConfig,
		_block: ToolUse,
		outcome: InteractionOutcome,
		commandResult?: ToolResponse,
	): Promise<ToolResponse> {
		const text = outcome.draft?.text
		const images = outcome.draft?.images
		const completionFiles = outcome.draft?.files
		const prefix = "[attempt_completion] Result: Done"
		if (outcome.actionId === "start_new_task") {
			return prefix
		}
		await sayFeedbackOnce(config, "messageResponse", text, images, completionFiles)

		// Run UserPromptSubmit hook when user provides post-completion feedback
		let hookContextModification: string | undefined
		if (text || (images && images.length > 0) || (completionFiles && completionFiles.length > 0)) {
			const userContentForHook = await buildUserFeedbackContent(text, images, completionFiles)

			const hookResult = await config.callbacks.runUserPromptSubmitHook(userContentForHook, "feedback")

			if (hookResult.cancel === true) {
				return formatResponse.toolDenied()
			}

			// Capture hook context modification to add to tool results
			hookContextModification = hookResult.contextModification
		}

		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({
					type: "text",
					text: commandResult,
				})
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}

		if (text) {
			toolResults.push(
				{
					type: "text",
					text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
				},
				{
					type: "text",
					text: `<feedback>\n${text}\n</feedback>`,
				},
			)
		}

		// Add hook context modification if provided
		if (hookContextModification) {
			toolResults.push({
				type: "text" as const,
				text: `<hook_context source="UserPromptSubmit">\n${hookContextModification}\n</hook_context>`,
			})
		}

		const fileContentString = completionFiles?.length ? await processFilesIntoText(completionFiles) : ""
		if (fileContentString) {
			toolResults.push({
				type: "text" as const,
				text: fileContentString,
			})
		}

		if (images && images.length > 0) {
			toolResults.push(...formatResponse.imageBlocks(images))
		}

		// Return the tool results as a complex response
		return [
			{
				type: "text" as const,
				text: prefix,
			},
			...toolResults,
		]
	}

	/**
	 * Runs the TaskComplete hook after user confirms task completion.
	 * This is a non-cancellable, observation-only hook similar to TaskCancel.
	 * Errors are logged but do not affect task completion.
	 */
	private async runTaskCompleteHook(config: TaskConfig, block: ToolUse): Promise<void> {
		const hooksEnabled = getHooksEnabledSafe(config.services.stateManager.getGlobalSettingsKey("hooksEnabled"))
		if (!hooksEnabled) {
			return
		}

		try {
			const { executeHook } = await import("@core/hooks/hook-executor")

			await executeHook({
				hookName: "TaskComplete",
				hookInput: {
					taskComplete: {
						taskMetadata: {
							taskId: config.taskId,
							ulid: config.ulid ?? "",
							result: block.params.result || "",
							command: block.params.command || "",
						},
					},
				},
				isCancellable: false, // Non-cancellable - task is already complete
				say: config.callbacks.say,
				setActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				clearActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				messageStateHandler: config.messageState,
				taskId: config.taskId,
				hooksEnabled,
				model: getHookModelContext(config.api, config.services.stateManager),
			})
		} catch (error) {
			// TaskComplete hook failed - non-fatal, just log
			Logger.error("[TaskComplete Hook] Failed (non-fatal):", error)
		}
	}
}
