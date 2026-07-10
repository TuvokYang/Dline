import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { findLast, parsePartialArrayString } from "@shared/array"
import { telemetryService } from "@/services/telemetry"
import { ClinePlanModeResponse } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { isCompactSignal } from "../../mode-switch-signal"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getTaskCompletionTelemetry } from "../utils"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

export class PlanModeRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.PLAN_MODE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for plan_mode_respond
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = block.params.response
		const optionsRaw = block.params.options

		const sharedMessage = {
			response: uiHelpers.removeClosingTag(block, "response", response),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies ClinePlanModeResponse

		await uiHelpers.ask(this.name, JSON.stringify(sharedMessage), true, { existingTs: block.ts }).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = block.params.response
		const optionsRaw: string | undefined = block.params.options
		const needsMoreExploration: boolean = block.params.needs_more_exploration === "true"

		// Validate required parameters
		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		// The plan_mode_respond tool tends to run into this issue where the model realizes mid-tool call that it should have called another tool before calling plan_mode_respond. And it ends the plan_mode_respond tool call with 'Proceeding to reading files...' which doesn't do anything because we restrict to 1 tool call per message. As an escape hatch for the model, we provide it the optionality to tack on a parameter at the end of its response `needs_more_exploration`, which will allow the loop to continue.
		if (needsMoreExploration) {
			return formatResponse.toolResult(getPrompt("toolHandlers", "planNeedsMoreExploration"))
		}

		// For safety, if we are in yolo mode and we get a plan_mode_respond tool call we should always continue the loop
		if (config.yoloModeToggled && config.mode === "act") {
			return formatResponse.toolResult(getPrompt("toolHandlers", "planYoloAutoExecute"))
		}

		// Store the number of options for telemetry
		const options = parsePartialArrayString(optionsRaw || "[]")

		const sharedMessage = {
			response: response,
			options: options,
		}

		// Auto-switch to Act mode while in yolo mode
		if (config.mode === "plan" && config.yoloModeToggled && !needsMoreExploration) {
			// Trigger automatic mode switch
			const switchSuccessful = await config.callbacks.switchToActMode()

			if (switchSuccessful) {
				// Complete the plan mode response tool call (this is a unique case where we auto-respond to the user with an ask response)
				const lastPlanMessage = findLast(config.messageState.clineMessages, (m: any) => m.ask === this.name)
				if (lastPlanMessage) {
					lastPlanMessage.text = JSON.stringify({
						...sharedMessage,
					} satisfies ClinePlanModeResponse)
					lastPlanMessage.partial = false
					await config.messageState.updateTaskHistory()
				}

				// we dont need to process any text, options, files or other content here
				return formatResponse.toolResult(getPrompt("toolHandlers", "planYoloSwitchToAct"))
			}
			Logger.warn(getPrompt("toolHandlers", "planYoloSwitchFailed"))
		}

		// Set awaiting plan response state
		config.taskState.isAwaitingPlanResponse = true

		// Ask for user response
		let {
			response: askResponse,
			text,
			images,
			files: planResponseFiles,
		} = await config.callbacks.ask(this.name, JSON.stringify(sharedMessage), false, { existingTs: block.ts })

		config.taskState.isAwaitingPlanResponse = false

		if (isCompactSignal(text)) {
			return formatResponse.toolResult("Mode switch context compaction requested.")
		}

		// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
		if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
			text = ""
		}

		// Check if options contains the text response
		if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
			telemetryService.captureOptionSelected(config.ulid ?? "", options.length, "plan")
			// Valid option selected, don't show user message in UI
			// Update last plan message with selected option
			const lastPlanMessage = findLast(config.messageState.clineMessages, (m: any) => m.ask === this.name)
			if (lastPlanMessage) {
				lastPlanMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies ClinePlanModeResponse)
				await config.messageState.updateTaskHistory()
			}
		} else {
			// Option not selected, send user feedback
			if (text || (images && images.length > 0) || (planResponseFiles && planResponseFiles.length > 0)) {
				telemetryService.captureOptionsIgnored(config.ulid ?? "", options.length, "plan")
				await sayFeedbackOnce(config, askResponse, text, images, planResponseFiles)
			}
		}

		let fileContentString = ""
		if (planResponseFiles && planResponseFiles.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(planResponseFiles)
		}

		telemetryService.captureTaskCompleted(config.ulid ?? "", getTaskCompletionTelemetry(config))

		// Handle mode switching response
		if (config.taskState.didRespondToPlanAskBySwitchingMode) {
			const switchMsg = text
				? getPrompt("toolHandlers", "planSwitchToActWithMessage", { text })
				: getPrompt("toolHandlers", "planSwitchToAct")
			const result = formatResponse.toolResult(switchMsg, images, fileContentString)
			// Reset the flag after using it to prevent it from persisting
			config.taskState.didRespondToPlanAskBySwitchingMode = false
			return result
		}
		// if we didn't switch to ACT MODE, then we can just send the user_feedback message
		return formatResponse.toolResult(`<feedback>\n${text}\n</feedback>`, images, fileContentString)
	}
}
