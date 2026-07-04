import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { ClineQnaResponse } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * QnaRespondHandler — handles the qna_respond tool.
 *
 * Mirrors PlanModeRespondHandler exactly:
 * handlePartialBlock uses ask() so content streams into the Q&A component,
 * execute uses ask() to finalize content, save checkpoint, and block for user input.
 */
export class QnaRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.QNA_RESPOND

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = uiHelpers.removeClosingTag(block, "response", block.params.response)
		if (response) {
			const sharedMessage: ClineQnaResponse = { response }
			await uiHelpers.ask(this.name, JSON.stringify(sharedMessage), true, { existingTs: block.ts }).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = (block.params as Record<string, string | undefined>).response

		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "response", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		const sharedMessage: ClineQnaResponse = { response }

		config.taskState.isAwaitingPlanResponse = true

		let { text, images, files } = await config.callbacks.ask(this.name, JSON.stringify(sharedMessage), false, {
			existingTs: block.ts,
		})

		config.taskState.isAwaitingPlanResponse = false

		if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
			text = ""
		}

		await config.callbacks.saveCheckpoint(true)

		let fileContentString = ""
		if (files && files.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(files)
		}

		if (text || (images && images.length > 0) || fileContentString) {
			await config.callbacks.say("user_feedback", text ?? "", images, files)
			return formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images, fileContentString)
		}

		return formatResponse.toolResult("User continued the conversation.")
	}
}
