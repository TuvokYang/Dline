import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"

import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import { interactionId, interactionTurnId, type TaskConfig } from "../types/TaskConfig"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

/**
 * SpawnTaskHandler â€?handles the spawn_task tool.
 *
 * Creates a new Editor Tab panel with an independent Controller/Task
 * that inherits the parent task's (provider ?? ""), MCP servers, and rules.
 * The spawned task starts in PLAN mode with auto-run.
 *
 * Only available on main (non-spawned) tasks.
 */
export class SpawnTaskHandler implements IToolHandler {
	readonly name = ClineDefaultTool.SPAWN_TASK

	getDescription(_block: ToolUse): string {
		return `[spawn_task]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as Record<string, string | undefined>
		const taskDescription: string | undefined = params.task
		const contextParam: string | undefined = params.context

		if (!taskDescription) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "task", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		const approvalBody = JSON.stringify({ task: taskDescription, context: contextParam })
		const outcome = await config.interactions.open({
			turnId: interactionTurnId(block),
			interactionId: interactionId(block),
			kind: "spawn_task_approval",
			presentation: approvalBody,
			existingTs: block.ts,
		})
		const text = outcome.draft?.text
		const images = outcome.draft?.images
		const files = outcome.draft?.files

		if (outcome.actionId !== "approve") {
			// Reject the active block to update the approval state machine
			// and cascade SKIPPED to subsequent approval-requiring blocks.
			config.taskController.rejectActiveBlock()
			// Handle user feedback if provided
			if (text || (images && images.length > 0) || (files && files.length > 0)) {
				await sayFeedbackOnce(config, "noButtonClicked", text, images, files)
				return formatResponse.toolResult(
					`The user provided feedback instead of spawning a task:\n<feedback>\n${text}\n</feedback>`,
					images,
				)
			}
			return formatResponse.toolDenied()
		}

		// Check if parent task was aborted before starting async spawn operations
		if (config.taskState.abort) {
			return formatResponse.toolError("Task was aborted before spawn could complete")
		}

		let panelProvider: any = null
		try {
			// VscodeWebviewPanelProvider is expensive to load and cannot be constructed
			// without the extension context, so reject incomplete task configs first.
			const controllerContext = config.controllerContext
			if (!controllerContext) {
				return formatResponse.toolError(getPrompt("toolHandlers", "spawnTaskFailed"))
			}

			// Dynamically import to avoid circular deps at module load time
			const { VscodeWebviewPanelProvider } = await import("@/hosts/vscode/VscodeWebviewPanelProvider")

			// Check after dynamic import — parent may have been aborted during import
			if (config.taskState.abort) {
				return formatResponse.toolError("Task was aborted before spawn could complete")
			}

			// Get parent task's current provider info to pass to spawn
			const parentTaskId = config.taskId
			const apiConfiguration = config.services.stateManager.getApiConfiguration()
			const mode = config.services.stateManager.getGlobalSettingsKey("mode") || "plan"
			const currentProfile = mode === "plan" ? apiConfiguration.planModeProfile : apiConfiguration.actModeProfile
			if (!currentProfile) {
				return formatResponse.toolError(`No profile configured for ${mode} mode`)
			}

			panelProvider = new VscodeWebviewPanelProvider(controllerContext, { deferController: false })

			// Truncate title for tab display
			const title = taskDescription.length > 16 ? taskDescription.substring(0, 16) : taskDescription
			await panelProvider.createPanel(title)

			// Check after panel creation — most expensive async step
			if (config.taskState.abort) {
				// Clean up the panel we just created
				panelProvider.dispose().catch(() => {})
				return formatResponse.toolError("Task was aborted during spawn panel creation")
			}

			// Build the prompt â€?only pass the task description.
			// Context is passed as a separate string[] for cache-friendly independent text blocks.
			const fullPrompt = taskDescription

			// Set provider/mode on the new controller to inherit from parent
			const childController = panelProvider.controller
			const childTaskId = await childController.initTask(
				fullPrompt,
				undefined,
				undefined,
				undefined,
				{
					planModeProfile: currentProfile,
					actModeProfile: currentProfile,
					mode: "plan" as any,
				},
				contextParam ? { context: [contextParam] } : undefined,
			)

			// Final check after initTask — parent may have been aborted during initialization
			if (config.taskState.abort) {
				// Clean up the child task that was just created
				childController.clearTask().catch(() => {})
				childController.dispose().catch(() => {})
				return formatResponse.toolError("Task was aborted after spawn initialization")
			}

			// Register with orchestrator
			const { OrchestratorController } = await import("@/core/orchestrator/OrchestratorController")
			OrchestratorController.getInstance().spawnTask(childTaskId, childController, parentTaskId)

			// Return success with task ID
			return formatResponse.toolResult(
				`Spawned new task "${taskDescription}" with ID: ${childTaskId}. The task has been created in a new editor tab.`,
			)
		} catch (error) {
			return formatResponse.toolError(`Failed to spawn task: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
}
