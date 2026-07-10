import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

export class GenerateReportHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.GENERATE_REPORT

	getDescription(block: ToolUse): string {
		return `[${block.name}] ${(block.params as Record<string, string>).title || ""}`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const content = uiHelpers.removeClosingTag(block, "content", block.params.content)
		if (content) {
			const sharedMessage = JSON.stringify({
				title: block.params.title || "",
				content,
			})
			await uiHelpers.ask("generate_report" as any, sharedMessage, true, { existingTs: block.ts }).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const title: string = (block.params as Record<string, string>).title || ""
		const content: string = (block.params as Record<string, string>).content || ""

		if (!title || !content) {
			config.taskState.consecutiveMistakeCount++
			const missingParam = !title ? "title" : "content"
			return await config.callbacks.sayAndCreateMissingParamError(block.name, missingParam, undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		const sharedMessage = JSON.stringify({ title, content })

		config.taskState.isAwaitingPlanResponse = true

		const {
			response: askResponse,
			text,
			images,
			files,
		} = await config.callbacks.ask("generate_report" as any, sharedMessage, false, {
			existingTs: block.ts,
		})

		config.taskState.isAwaitingPlanResponse = false

		// Handle mode switching response (same as PlanModeRespondHandler)
		if (config.taskState.didRespondToPlanAskBySwitchingMode) {
			config.taskState.didRespondToPlanAskBySwitchingMode = false
			const switchMsg = text
				? getPrompt("toolHandlers", "planSwitchToActWithMessage", { text })
				: getPrompt("toolHandlers", "planSwitchToAct")
			// fileContentString is empty at this point, pass images directly
			return formatResponse.toolResult(switchMsg, images, "")
		}

		let fileContentString = ""
		if (files && files.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(files)
		}

		if (text || (images && images.length > 0) || fileContentString) {
			await sayFeedbackOnce(config, askResponse, text, images, files)
			return formatResponse.toolResult(`<feedback>\n${text}\n</feedback>`, images, fileContentString)
		}

		return formatResponse.toolResult("[GENERATE_REPORT] User reviewed the report and continued.")
	}
}
