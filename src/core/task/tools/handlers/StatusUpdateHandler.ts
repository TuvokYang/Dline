import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class StatusUpdateHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.STATUS_UPDATE

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = (block.params as Record<string, string>).response
		const message = uiHelpers.removeClosingTag(block, "response", response)
		await uiHelpers.say("text", message, undefined, undefined, true, block.ts).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = (block.params as Record<string, string>).response
		const requiresAck: boolean = (block.params as Record<string, string>).requires_acknowledgment === "true"

		// Block consecutive status_update calls to prevent narration loops
		if (config.taskState.lastToolName === ClineDefaultTool.STATUS_UPDATE) {
			return formatResponse.toolResult(
				`[BLOCKED] You cannot call status_update consecutively. ` +
					`Your next action MUST be a different tool that performs actual work: ` +
					`read_file, replace_in_file, write_to_file, execute_command, list_files, search_files, etc. ` +
					`Stop announcing and start doing.`,
			)
		}

		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		if (requiresAck) {
			// Ask path: show "知晓/停止" buttons, wait for user response
			const { text } = await config.callbacks.ask("status_acknowledgment" as any, response, false, { existingTs: block.ts })
			if (text === "stop") {
				return formatResponse.toolResult("[STATUS_UPDATE] User chose to stop. Wait for further instructions.")
			}
			return formatResponse.toolResult("[STATUS_UPDATE] User acknowledged. Continue with your next tool call.")
		}

		// Say path (default): display as tool message with status_update identifier
		const toolMsg = JSON.stringify({ tool: "statusUpdate", content: response })
		await config.callbacks.say("tool", toolMsg, undefined, undefined, false, block.ts)

		return formatResponse.toolResult(
			`[Message displayed. Now proceed with your next tool call - ` +
				`it must be a different tool (read_file, replace_in_file, execute_command, etc.), ` +
				`not status_update again.]`,
		)
	}
}
