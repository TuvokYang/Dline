import { resolveProvider } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import { WorkspacePathAdapter } from "@core/workspace/WorkspacePathAdapter"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showApprovalNotification, showSystemNotification } from "@integrations/notifications"
import type { CommandExecutionOutcome } from "@integrations/terminal"
import { findLastIndex } from "@shared/array"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineAsk } from "@shared/ExtensionMessage"
import { DEFAULT_TERMINAL_COMMAND_TIMEOUT_SECONDS, MIN_TERMINAL_COMMAND_TIMEOUT_SECONDS } from "@shared/terminal-settings"
import { arePathsEqual } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import { interactionId, interactionTurnId, type TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"
import { parseCommandExecutionOptions } from "./command-execution-options"
import { resolveCommandWorkdirectory } from "./command-workdirectory"

export { resolveCommandTimeoutSeconds } from "./command-execution-options"

export function commandResultForModel(outcome: CommandExecutionOutcome, muteStdout: boolean): ToolResponse {
	if (
		muteStdout &&
		outcome.completed &&
		!outcome.userRejected &&
		outcome.exitCode === 0 &&
		!outcome.signal &&
		!outcome.timedOut
	) {
		return "Command executed successfully (exit code 0)."
	}
	return outcome.result
}

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	constructor(readonly name: ClineDefaultTool.BASH | ClineDefaultTool.KILL_COMMAND = ClineDefaultTool.BASH) {}

	getDescription(block: ToolUse): string {
		if (block.name === ClineDefaultTool.KILL_COMMAND) {
			return `[${block.name} for '${block.params.function_id}']`
		}
		const workdirectory = block.params.workdirectory ? ` in '${block.params.workdirectory}'` : ""
		return `[${block.name} for '${block.params.command}'${workdirectory}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		if (block.name === ClineDefaultTool.KILL_COMMAND) return
		const command = block.params.command
		if (uiHelpers.getConfig().isSubagentExecution) {
			return
		}

		// Check if this should be auto-approved to determine UI flow
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			// For auto-approved commands, we can't partially stream a say prematurely
			// since it may become an ask based on the requires_approval parameter
			// So we wait for the complete block
			return
		}
		await uiHelpers
			.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "command", command), true, { existingTs: block.ts })
			.catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		if (block.name === ClineDefaultTool.KILL_COMMAND) {
			return this.executeKillCommand(config, block)
		}

		let command: string | undefined = block.params.command
		const requiresApprovalRaw: string | undefined = block.params.requires_approval
		const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"
		const timeoutParam: string | undefined = block.params.timeout
		const backgroundParam: string | undefined = block.params.background
		const synchronousParam: string | undefined = block.params.synchronous
		const muteStdoutParam: string | undefined = block.params.mute_stdout
		const workdirectoryParam: string | undefined = block.params.workdirectory

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = resolveProvider(apiConfig, currentMode)

		// Validate required parameters
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			await config.callbacks.say(
				"error",
				"Dline tried to use execute_command without value for required parameter 'command'. Retrying...",
			)
			return formatResponse.toolError(formatResponse.executeCommandMissingCommandError())
		}

		if (!requiresApprovalRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "requires_approval", undefined, block.ts)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse only explicit tool overrides. The current Settings default is read at launch.
		const executionOptions = parseCommandExecutionOptions(
			command,
			backgroundParam,
			timeoutParam,
			synchronousParam,
			muteStdoutParam,
		)

		// Pre-process command for certain models
		if (config.api.getModel().id.includes("gemini")) {
			command = applyModelContentFixes(command)
		}

		// Handle multi-workspace command execution
		let actualCommand: string = command

		let workspaceHintUsed = false
		let workspaceHint: string | undefined

		let requestedWorkdirectory = workdirectoryParam
		const adapter = new WorkspacePathAdapter({
			cwd: config.cwd,
			isMultiRootEnabled: config.isMultiRootEnabled,
			workspaceManager: config.workspaceManager,
		})

		if (config.isMultiRootEnabled && config.workspaceManager) {
			// Check if command has a workspace hint prefix
			// e.g., "@backend:npm install" or just "npm install"
			const commandMatch = command.match(/^@(\w+):(.+)$/)

			if (commandMatch) {
				workspaceHintUsed = true
				workspaceHint = commandMatch[1]
				actualCommand = commandMatch[2].trim()

				// Resolve to get the workspace directory
				if (!requestedWorkdirectory) {
					requestedWorkdirectory = adapter.resolvePath(".", workspaceHint)
				}

				// Update command to remove the workspace prefix for display
				command = actualCommand
			}
			// If no hint, use primary workspace (cwd)
		}

		const workdirectoryHintMatch = requestedWorkdirectory?.match(/^@([^:]+):(.*)$/)
		if (workdirectoryHintMatch && config.isMultiRootEnabled && config.workspaceManager) {
			workspaceHintUsed = true
			workspaceHint = workdirectoryHintMatch[1]
			requestedWorkdirectory = adapter.resolvePath(workdirectoryHintMatch[2] || ".", workspaceHint)
		} else if (requestedWorkdirectory) {
			requestedWorkdirectory = adapter.resolvePath(requestedWorkdirectory)
		}

		let resolvedWorkdirectory: Awaited<ReturnType<typeof resolveCommandWorkdirectory>>
		try {
			resolvedWorkdirectory = await resolveCommandWorkdirectory({
				cwd: config.cwd,
				requestedPath: requestedWorkdirectory,
				workspaceRoots: config.workspaceManager?.getRoots().map((root) => root.path),
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (!config.isSubagentExecution) {
				await config.callbacks.say("error", message)
			}
			return formatResponse.toolError(message)
		}
		const executionDir = resolvedWorkdirectory.path
		const requiresExternalWorkdirectoryApproval = !resolvedWorkdirectory.isWithinWorkspace

		// Check command permission validation (DLINE_COMMAND_PERMISSIONS env var)
		const permissionResult = config.services.commandPermissionController.validateCommand(actualCommand)
		if (!permissionResult.allowed) {
			let errorMessage: string
			if (permissionResult.failedSegment) {
				errorMessage =
					`Command "${actualCommand}" was denied by DLINE_COMMAND_PERMISSIONS. ` +
					`Segment "${permissionResult.failedSegment}" ${permissionResult.reason}.`
			} else {
				const matchedPattern = permissionResult.matchedPattern
					? ` (matched pattern: ${permissionResult.matchedPattern})`
					: ""
				errorMessage =
					`Command "${actualCommand}" was denied by DLINE_COMMAND_PERMISSIONS. ` +
					`Reason: ${permissionResult.reason}${matchedPattern}`
			}
			if (!config.isSubagentExecution) {
				await config.callbacks.say("command_permission_denied", errorMessage)
			}
			return formatResponse.toolError(formatResponse.permissionDeniedError(errorMessage))
		}

		// Check clineignore validation for command
		if (!config.services.ignoreController.validateDirectoryAccess(executionDir)) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("clineignore_error", executionDir)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(executionDir))
		}

		const ignoredFileAttemptedToAccess = config.services.ignoreController.validateCommand(actualCommand, executionDir)
		if (ignoredFileAttemptedToAccess) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("clineignore_error", ignoredFileAttemptedToAccess)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess))
		}

		let didAutoApprove = false

		// If the model says this command is safe and auto approval for safe commands is true, execute the command
		// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(block.name)
		const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		// Determine workspace context for telemetry
		const resolvedRoot = config.workspaceManager?.resolvePathToRoot(executionDir)
		const primaryRoot = config.workspaceManager?.getPrimaryRoot()?.path ?? config.cwd
		const resolvedToNonPrimary = resolvedRoot ? !arePathsEqual(resolvedRoot.path, primaryRoot) : false
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: workspaceHintUsed,
			resolvedToNonPrimary,
			resolutionMethod: workdirectoryParam
				? ("path_detection" as const)
				: workspaceHintUsed
					? ("hint" as const)
					: ("primary_fallback" as const),
		}

		// Capture workspace path resolution telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			telemetryService.captureWorkspacePathResolved(
				config.ulid ?? "",
				"ExecuteCommandToolHandler",
				workspaceHintUsed ? "hint_provided" : "fallback_to_primary",
				workspaceHintUsed ? "workspace_name" : undefined,
				resolvedToNonPrimary, // resolution success = resolved to different workspace
				undefined, // TODO: could calculate workspace index if needed
				true,
			)
		}

		if (
			!requiresExternalWorkdirectoryApproval &&
			(config.isSubagentExecution ||
				(!requiresApprovalPerLLM && autoApproveSafe) ||
				(requiresApprovalPerLLM && autoApproveSafe && autoApproveAll))
		) {
			// Auto-approve flow: render the execution directory the same way the manual
			// approval presentation does, so the workdirectory row is shown consistently.
			if (!config.isSubagentExecution) {
				const existingTs = block.ts
				await config.callbacks.say(
					"command",
					`${actualCommand}\n\nWorking directory: ${executionDir}`,
					undefined,
					undefined,
					false,
					existingTs,
				)
			}
			didAutoApprove = true
			telemetryService.captureToolUsage(
				config.ulid ?? "",
				block.name,
				config.api.getModel().id,
				provider ?? "",
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			const approvalPresentation = `${actualCommand}\n\nWorking directory: ${executionDir}`
			const requiresExplicitApproval = requiresExternalWorkdirectoryApproval || (autoApproveSafe && requiresApprovalPerLLM)
			// Manual approval flow
			void showApprovalNotification(
				{ message: approvalPresentation, requiresExplicitApproval },
				config.autoApprovalSettings.enableNotifications,
			)

			const outcome = await config.interactions.open({
				turnId: interactionTurnId(block),
				interactionId: interactionId(block),
				kind: "command_approval",
				presentation: `${approvalPresentation}${requiresExplicitApproval ? COMMAND_REQ_APP_STRING : ""}`,
				existingTs: block.ts,
			})
			const text = outcome.draft?.text
			const images = outcome.draft?.images
			const files = outcome.draft?.files
			if (text || images?.length || files?.length) {
				const fileContent = files?.length ? await processFilesIntoText(files) : ""
				ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContent)
				await sayFeedbackOnce(
					config,
					outcome.actionId === "approve" ? "yesButtonClicked" : "noButtonClicked",
					text,
					images,
					files,
				)
			}
			const didApprove = outcome.actionId === "approve"
			if (!didApprove) {
				// Mark the command ask message as skipped so the UI shows the correct status
				const msgs = config.messageState.clineMessages
				const cmdIdx = findLastIndex(msgs, (m: any) => m.ask === "command" || m.say === "command")
				if (cmdIdx !== -1) {
					await config.callbacks.updateClineMessage(cmdIdx, { commandStatus: "skipped" })
				}
				telemetryService.captureToolUsage(
					config.ulid ?? "",
					block.name,
					config.api.getModel().id,
					provider ?? "",
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid ?? "",
				block.name,
				config.api.getModel().id,
				provider ?? "",
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		// Run PreToolUse hook after approval but before execution
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

		// Setup timeout notification for long-running auto-approved commands
		let timeoutId: NodeJS.Timeout | undefined
		if (didAutoApprove && config.autoApprovalSettings.enableNotifications && !config.isSubagentExecution) {
			// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
			timeoutId = setTimeout(() => {
				showSystemNotification({
					subtitle: "Command is still running",
					message: "An auto-approved command has been running for 30s, and may need your attention.",
				})
			}, 30_000)
		}

		const configuredTimeout = config.services.stateManager.getGlobalSettingsKey("terminalCommandTimeoutSeconds")
		const defaultTimeout =
			typeof configuredTimeout === "number" &&
			Number.isSafeInteger(configuredTimeout) &&
			configuredTimeout >= MIN_TERMINAL_COMMAND_TIMEOUT_SECONDS
				? configuredTimeout
				: DEFAULT_TERMINAL_COMMAND_TIMEOUT_SECONDS
		const timeoutSeconds = executionOptions.timeoutSeconds ?? defaultTimeout

		const outcome = await config.callbacks.executeCommandTool(actualCommand, timeoutSeconds, {
			commandTs: block.ts,
			functionId: block.function_id,
			startInBackground: executionOptions.background,
			synchronous: executionOptions.synchronous,
			workdirectory: executionDir,
		})

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		if (!outcome.userRejected) {
			config.taskState.fileReadCache.clear()
		}

		if (outcome.backgroundCommandId && typeof outcome.result === "string") {
			return `${outcome.result}\nfunction_id: ${block.function_id}`
		}
		return commandResultForModel(outcome, executionOptions.muteStdout)
	}

	private async executeKillCommand(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const functionId = block.params.function_id?.trim()
		if (!functionId) {
			config.taskState.consecutiveMistakeCount++
			return config.callbacks.sayAndCreateMissingParamError(this.name, "function_id", undefined, block.ts)
		}

		const killCommand = config.callbacks.killCommandTool
		if (!killCommand) {
			return formatResponse.toolError(getPrompt("killCommand", "unavailableError"))
		}

		config.taskState.consecutiveMistakeCount = 0
		const cancellation = await killCommand(functionId)
		const result = getPrompt("killCommand", cancellation.cancelled ? "terminationRequested" : "notRunning")
		if (!config.isSubagentExecution) {
			await config.callbacks.say(
				"tool",
				JSON.stringify({
					tool: "killCommand",
					path: cancellation.command ?? functionId,
					content: result,
					activityId: cancellation.activityId,
				}),
				undefined,
				undefined,
				false,
				block.ts,
			)
		}
		return formatResponse.toolResult(result)
	}
}
