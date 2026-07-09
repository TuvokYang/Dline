import path from "node:path"
import { ApiHandler, resolveProviderFromProfile } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { getHookModelContext } from "@core/hooks/hook-model-context"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { CommandPermissionController } from "@core/permissions"
import { TaskFileTracker } from "@integrations/checkpoints/TaskFileTracker"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { CommandExecutionOptions } from "@integrations/terminal"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { DEFAULT_API_PROVIDER } from "@shared/api"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineContent, type ClineToolResponseContent } from "@shared/messages/content"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool, toolUseNames } from "@shared/tools"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { isParallelToolCallingEnabled, modelDoesntSupportWebp } from "@/utils/model-utils"
import { isLocatedInPath } from "@/utils/path"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
import { formatResponse } from "../prompts/responses"
import { StateManager } from "../storage/StateManager"
import { WorkspaceRootManager } from "../workspace"
import { isTurnEndingToolName } from "./assistant-message-order"
import { isAllItemsCompleted } from "./focus-chain/file-utils"
import { checkRepeatedToolCall, LOOP_DETECTION_SOFT_THRESHOLD, toolCallSignature } from "./loop-detection"
import { MessageStateHandler } from "./message-state"
import { TaskController } from "./TaskController"
import { TaskState } from "./TaskState"
import { AutoApprove } from "./tools/autoApprove"
import { SubagentJobManager } from "./tools/subagent/SubagentJobManager"
import { IPartialBlockHandler, ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import { TaskConfig, validateTaskConfig } from "./tools/types/TaskConfig"
import { createUIHelpers } from "./tools/types/UIHelpers"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

type ToolResponse = ClineToolResponseContent

export function canonicalizeAttemptCompletionParams(block: ToolUse): boolean {
	if (block.name === ClineDefaultTool.ATTEMPT && !block.params?.result && typeof block.params?.response === "string") {
		block.params.result = block.params.response
		return true
	}

	return false
}

/**
 * Resolve whether a tool use should be auto-approved from tool params.
 * @param toolName Tool name from the assistant block.
 * @param params Tool parameters from the assistant block.
 * @param autoApproveResult Auto-approve setting result for the tool.
 * @returns True when the block should skip manual approval.
 */
export function isToolUseAutoApproved(
	toolName: ClineDefaultTool,
	params: ToolUse["params"] | undefined,
	autoApproveResult: boolean | [boolean, boolean],
): boolean {
	if (toolName === ClineDefaultTool.BASH) {
		const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]
		const requiresApprovalRaw = params?.requires_approval
		const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"
		return (!requiresApprovalPerLLM && autoApproveSafe) || (requiresApprovalPerLLM && autoApproveSafe && autoApproveAll)
	}

	if (Array.isArray(autoApproveResult)) {
		return autoApproveResult[0] || autoApproveResult[1]
	}
	return !!autoApproveResult
}

interface BlockApproveOptions {
	cwd: string
	autoApproveResult: boolean | [boolean, boolean]
	workspaceRoots?: string[]
}

const PATH_AUTO_APPROVE_TOOLS = new Set<ClineDefaultTool>([
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.SEARCH,
])

/**
 * Extract the filesystem path parameter used for path-scoped auto-approval.
 * @param block Tool use block emitted by the assistant.
 * @returns Path parameter when the tool is path-scoped, otherwise undefined.
 */
function getApprovePath(block: ToolUse): string | undefined {
	if (!PATH_AUTO_APPROVE_TOOLS.has(block.name)) {
		return undefined
	}
	return block.params?.path
}

/**
 * Resolve whether a path-scoped tool use is inside the workspace roots.
 * @param cwd Primary workspace path.
 * @param toolPath Tool path parameter supplied by the assistant.
 * @param workspaceRoots Optional workspace roots for multi-root workspaces.
 * @returns True when the resolved path is inside any workspace root.
 */
function isLocalPath(cwd: string, toolPath: string, workspaceRoots?: string[]): boolean {
	const absolutePath = path.isAbsolute(toolPath) ? path.resolve(toolPath) : path.resolve(cwd, toolPath)
	const roots = workspaceRoots && workspaceRoots.length > 0 ? workspaceRoots : [cwd]
	return roots.some((root) => isLocatedInPath(root, absolutePath))
}

/**
 * Resolve whether a complete tool block should skip manual approval.
 * @param block Complete tool use block with params.
 * @param options Workspace and auto-approval settings for this task.
 * @returns True when the block is safe to auto-execute.
 */
export function isBlockAutoApproved(block: ToolUse, options: BlockApproveOptions): boolean {
	const toolPath = getApprovePath(block)
	if (!toolPath) {
		return PATH_AUTO_APPROVE_TOOLS.has(block.name)
			? false
			: isToolUseAutoApproved(block.name, block.params, options.autoApproveResult)
	}

	const [autoApproveLocal, autoApproveExternal] = Array.isArray(options.autoApproveResult)
		? options.autoApproveResult
		: [options.autoApproveResult, false]
	const isLocal = isLocalPath(options.cwd, toolPath, options.workspaceRoots)
	return (isLocal && autoApproveLocal) || (!isLocal && autoApproveLocal && autoApproveExternal)
}

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator
	private subagentJobManager = new SubagentJobManager()

	/** Public accessor for auto-approve logic used by TaskController.buildTurn(). */
	public isAutoApproved(toolName: ClineDefaultTool, params?: ToolUse["params"]): boolean {
		const result = this.autoApprover.shouldAutoApproveTool(toolName)
		return isToolUseAutoApproved(toolName, params, result)
	}

	/** Public block-scoped accessor used by TaskController.buildTurn(). */
	public isBlockApproved(block: ToolUse): boolean {
		const result = this.autoApprover.shouldAutoApproveTool(block.name)
		const workspaceRoots = this.workspaceManager?.getRoots().map((root) => root.path)
		return isBlockAutoApproved(block, {
			cwd: this.cwd,
			autoApproveResult: result,
			workspaceRoots,
		})
	}

	/**
	 * Get the task-local background subagent job manager.
	 * @returns Subagent job manager owned by this tool executor.
	 */
	public getSubagentJobManager(): SubagentJobManager {
		return this.subagentJobManager
	}

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: ClineDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		return this.autoApprover.shouldAutoApproveToolWithPath(blockname, autoApproveActionpath)
	}

	constructor(
		// Core Services & Managers
		private taskState: TaskState,
		private taskController: TaskController,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private diffViewProvider: DiffViewProvider,
		private mcpHub: McpHub,
		private fileContextTracker: FileContextTracker,
		private taskFileTracker: TaskFileTracker,
		private clineIgnoreController: ClineIgnoreController,
		private commandPermissionController: CommandPermissionController,
		private contextManager: ContextManager,
		private stateManager: StateManager,

		// Configuration & Settings

		private cwd: string,
		private taskId: string,
		private ulid: string,
		private vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec",

		// Workspace Management
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,

		// Callbacks to the Task (Entity)
		private say: (
			type: ClineSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
			existingTs?: number,
		) => Promise<number | undefined>,
		private ask: (
			type: ClineAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{
			response: ClineAskResponse
			text?: string
			images?: string[]
			files?: string[]
		}>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>,
		private sayAndCreateMissingParamError: (
			toolName: ClineDefaultTool,
			paramName: string,
			relPath?: string,
			existingTs?: number,
		) => Promise<any>,
		private executeCommandTool: (
			command: string,
			timeoutSeconds: number | undefined,
			options?: CommandExecutionOptions,
		) => Promise<[boolean, any]>,
		private cancelRunningCommandTool: () => Promise<boolean>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
		private focusChainForceUpdate: (newPlan: string) => Promise<void>,
		private switchToActMode: () => Promise<boolean>,
		private cancelTask: () => Promise<void>,

		// Atomic hook state helpers from Task
		private setActiveHookExecution: (hookExecution: NonNullable<typeof taskState.activeHookExecution>) => Promise<void>,
		private clearActiveHookExecution: () => Promise<void>,
		private getActiveHookExecution: () => Promise<typeof taskState.activeHookExecution>,
		private runUserPromptSubmitHook: (
			userContent: ClineContent[],
			context: "initial_task" | "resume" | "feedback",
		) => Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }>,
		private updateClineMessage: (
			index: number,
			updates: { text?: string; exitCode?: number; commandStatus?: "pending" | "running" | "completed" | "skipped" },
		) => Promise<void>,
	) {
		this.autoApprover = new AutoApprove(this.stateManager)

		// Initialize the coordinator and register all tool handlers
		this.coordinator = new ToolExecutorCoordinator()
		this.registerToolHandlers()
	}

	// Create a properly typed TaskConfig object for handlers
	// NOTE: modifying this object in the tool handlers is okay since these are all references to the singular ToolExecutor instance's variables. However, be careful modifying this object assuming it will update the ToolExecutor instance, e.g. config.browserSession = ... will not update the ToolExecutor.browserSession instance variable. Use applyLatestBrowserSettings() instead.
	private asToolConfig(): TaskConfig {
		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			doubleCheckCompletionEnabled: this.stateManager.getGlobalSettingsKey("doubleCheckCompletionEnabled"),
			vscodeTerminalExecutionMode: this.vscodeTerminalExecutionMode,
			enableParallelToolCalling: this.isParallelToolCallingEnabled(),
			isSubagentExecution: false,
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			taskController: this.taskController,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: this.autoApprover,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				taskFileTracker: this.taskFileTracker,
				clineIgnoreController: this.clineIgnoreController,
				commandPermissionController: this.commandPermissionController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
			},
			callbacks: {
				focusChainForceUpdate: this.focusChainForceUpdate.bind(this),
				say: this.say,
				ask: this.ask,
				saveCheckpoint: this.saveCheckpoint,
				postStateToWebview: async () => {},
				reinitExistingTaskFromId: async () => {},
				cancelTask: this.cancelTask,
				updateTaskHistory: async () => [],
				executeCommandTool: this.executeCommandTool,
				cancelRunningCommandTool: this.cancelRunningCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				updateFCListFromToolResponse: this.updateFCListFromToolResponse,
				sayAndCreateMissingParamError: this.sayAndCreateMissingParamError,
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
				setActiveHookExecution: this.setActiveHookExecution,
				clearActiveHookExecution: this.clearActiveHookExecution,
				getActiveHookExecution: this.getActiveHookExecution,
				runUserPromptSubmitHook: this.runUserPromptSubmitHook,
				updateClineMessage: this.updateClineMessage,
			},
			coordinator: this.coordinator,
			controllerContext: (this as any)._controllerContext,
			subagentJobManager: this.subagentJobManager,
		}

		// Validate the config at runtime to catch any missing properties
		validateTaskConfig(config)
		return config
	}

	/**
	 * Register all tool handlers with the coordinator
	 */
	private registerToolHandlers(): void {
		const validator = new ToolValidator(this.clineIgnoreController)
		// Register all tools via toolUseNames
		for (const tool of toolUseNames) {
			this.coordinator.registerByName(tool, validator)
		}
	}

	/**
	 * Main entry point for tool execution - called by Task class
	 */
	public async executeTool(block: ToolUse): Promise<void> {
		await this.execute(block)
	}

	/**
	 * Updates the browser settings
	 */
	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const apiHandlerModel = this.api.getModel()
		const useWebp = this.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
		this.browserSession = new BrowserSession(this.stateManager, useWebp)
		return this.browserSession
	}

	/**
	 * Handles errors during tool execution.
	 *
	 * Logs the error, displays it to the user via the UI, and adds an error
	 * result to the conversation context so the AI can see what went wrong.
	 *
	 * @param action Description of what was being attempted (e.g., "executing read_file")
	 * @param error The error that occurred
	 * @param block The tool use block that caused the error
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		const errorString = `Error ${action}: ${error.message}`
		await this.say("error", errorString)

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	/**
	 * Pushes a tool result to the user message content.
	 *
	 * This is a critical method that:
	 * - Formats the tool result appropriately for the API
	 * - Adds it to the conversation context
	 * - Marks that a tool has been used in this turn
	 *
	 * @param content The tool response content to add
	 * @param block The tool use block that generated this result
	 */
	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		// Use the ToolResultUtils to properly format and push the tool result
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			(block: ToolUse) => ToolDisplayUtils.getToolDescription(block),
			this.coordinator,
			this.taskState.toolUseIdMap,
		)

		// Mark that a tool has been used (only matters when parallel tool calling is disabled)
		if (!this.isParallelToolCallingEnabled()) {
			this.taskState.didAlreadyUseTool = true
		}
	}

	// Record a partial_tool_result for resume. Must be awaited so the
	// webview message order is deterministic — fire-and-forget would let
	// auto-approved tool results race ahead of a subsequent ask.
	private async recordPartialToolResult(content: ToolResponse, block: ToolUse): Promise<void> {
		const resultText = typeof content === "string" ? content : JSON.stringify(content)
		const toolUseId = this.taskState.toolUseIdMap?.get(block.call_id || "") || block.call_id || ""
		// Storage + push handled by say(), gated by TaskController.send()
		await this.say("partial_tool_result", JSON.stringify({ tool_use_id: toolUseId, result: resultText }))
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model/provider supports native tool calling and handles parallel tools well
	 */
	private isParallelToolCallingEnabled(): boolean {
		const enableParallelSetting = this.stateManager.getGlobalSettingsKey("enableParallelToolCalling")
		const model = this.api.getModel()
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const currentProfile = mode === "plan" ? apiConfig.planModeProfile : apiConfig.actModeProfile
		const providerId = resolveProviderFromProfile(currentProfile) || DEFAULT_API_PROVIDER
		return isParallelToolCallingEnabled(enableParallelSetting, { providerId, model, mode })
	}

	/**
	 * Tools that are restricted in plan mode and can only be used in act mode
	 */
	private static readonly PLAN_MODE_RESTRICTED_TOOLS: ClineDefaultTool[] = [
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.NEW_RULE,
		ClineDefaultTool.APPLY_PATCH,
	]

	/**
	 * Execute a tool through the coordinator if it's registered.
	 *
	 * This is the main entry point for tool execution, called by the Task class.
	 * It handles:
	 * - Checking if the tool is registered with the coordinator
	 * - Validating tool execution is allowed (not rejected, not already used, etc.)
	 * - Enforcing plan mode restrictions on file modification tools
	 * - Delegating to partial or complete block handlers
	 * - Error handling and checkpointing
	 *
	 * @param block The tool use block to execute
	 * @returns true if the tool was handled (even if execution failed), false if not registered
	 */
	private async execute(block: ToolUse): Promise<boolean> {
		// Note: MCP tool name transformation happens earlier in ToolUseHandler.getPartialToolUsesAsContent()
		// The toolUseIdMap is updated at the point of transformation in index.ts

		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}
		canonicalizeAttemptCompletionParams(block)

		const config = this.asToolConfig()

		try {
			// Check if user rejected a previous tool
			if (this.taskController.wasRejected(block.call_id || "")) {
				const reason = block.partial
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				const message = `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`
				if (!this.pushSkippedNativeToolResult(block, message)) {
					this.createToolRejectionMessage(block, reason)
				}
				return true
			}

			// Check if a tool has already been used in this message (only enforced when parallel tool calling is disabled)
			if (!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool && !isTurnEndingToolName(block.name)) {
				const message = formatResponse.toolAlreadyUsed(block.name)
				if (!this.pushSkippedNativeToolResult(block, message)) {
					this.taskState.userMessageContent.push({
						type: "text",
						text: message,
					})
				}
				return true
			}

			// Logic for plan-mode tool call restrictions
			if (
				this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled") &&
				this.stateManager.getGlobalSettingsKey("mode") === "plan" &&
				block.name &&
				this.isPlanModeToolRestricted(block.name)
			) {
				const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
				await this.say("error", errorMessage)
				// Only push the final error message when the streaming is done.
				if (!block.partial) {
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
				}
				return true
			}

			// Close browser for non-browser tools
			if (block.name !== "browser_action") {
				await this.browserSession.closeBrowser()
			}

			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block, config)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block, config)
			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			return true
		}
	}

	/**
	 * Check if a tool is restricted in plan mode.
	 *
	 * In strict plan mode, file modification tools (write_to_file, editedExistingFile, etc.)
	 * are blocked. The AI must switch to Act mode to use these tools.
	 *
	 * @param toolName The name of the tool to check
	 * @returns true if the tool is restricted in plan mode, false otherwise
	 */
	private isPlanModeToolRestricted(toolName: ClineDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content.
	 *
	 * Used when a tool cannot be executed (e.g., user rejected a previous tool,
	 * tool was interrupted, etc.). Adds a text message to the conversation explaining
	 * why the tool was not executed.
	 *
	 * @param block The tool use block that was rejected
	 * @param reason Human-readable explanation of why the tool was rejected
	 */
	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	private pushSkippedNativeToolResult(block: ToolUse, message: string): boolean {
		if (block.partial || !block.isNativeToolCall || !block.call_id) {
			return false
		}

		this.pushToolResult(formatResponse.toolError(message), block)
		return true
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private addHookContextToConversation(contextModification: string | undefined, source: string): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		const hookContextBlock = {
			type: "text" as const,
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		}

		this.taskState.userMessageContent.push(hookContextBlock)
	}

	/**
	 * Runs the PostToolUse hook after tool execution.
	 * This is extracted from handleCompleteBlock to eliminate code duplication
	 * between success and error paths.
	 *
	 * @param block The tool use block that was executed
	 * @param toolResult The result from the tool execution
	 * @param executionSuccess Whether the tool executed successfully
	 * @param executionStartTime The timestamp when tool execution started
	 * @returns true if hook requested cancellation, false otherwise
	 */
	private async runPostToolUseHook(
		block: ToolUse,
		toolResult: any,
		executionSuccess: boolean,
		executionStartTime: number,
		hooksEnabled: boolean,
	): Promise<boolean> {
		const { executeHook } = await import("../hooks/hook-executor")

		const executionTimeMs = Date.now() - executionStartTime

		const postToolResult = await executeHook({
			hookName: "PostToolUse",
			hookInput: {
				postToolUse: {
					toolName: block.name,
					parameters: block.params,
					result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
					success: executionSuccess,
					executionTimeMs,
				},
			},
			isCancellable: true,
			say: this.say,
			setActiveHookExecution: this.setActiveHookExecution,
			clearActiveHookExecution: this.clearActiveHookExecution,
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled,
			model: getHookModelContext(this.api, this.stateManager),
			toolName: block.name,
		})

		// Handle cancellation request
		if (postToolResult.cancel === true) {
			const errorMessage = postToolResult.errorMessage || "Hook requested task cancellation"
			await this.say("error", errorMessage)
			return true
		}

		// Add context modification to the conversation if provided
		if (postToolResult.contextModification) {
			this.addHookContextToConversation(postToolResult.contextModification, "PostToolUse")
		}

		return false
	}

	/**
	 * Handle partial block streaming UI updates.
	 *
	 * During streaming API responses, the AI sends partial tool use blocks as they're
	 * generated. This method updates the UI to show the tool being constructed in real-time.
	 *
	 * NOTE: This is ONLY for UI updates. No tool results are pushed to the conversation
	 * during partial block handling. The complete block handler will add the final result.
	 *
	 * @param block The partial tool use block with incomplete parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handlePartialBlock(block: ToolUse, config: TaskConfig): Promise<void> {
		// NOTE: We don't push tool results in partial blocks because this is only for UI streaming.
		// The ToolExecutor will handle pushToolResult() when the complete block is processed.
		// This maintains separation of concerns: partial = UI updates, complete = final state changes.
		const handler = this.coordinator.getHandler(block.name)

		// Check if handler supports partial blocks with proper typing
		if (handler && "handlePartialBlock" in handler) {
			const uiHelpers = createUIHelpers(config)
			const partialHandler = handler as IPartialBlockHandler
			await partialHandler.handlePartialBlock(block, uiHelpers)
		}
	}

	/**
	 * Handle complete block execution.
	 *
	 * This is the main execution flow for a tool:
	 * 1. Execute the actual tool (tool handlers now run PreToolUse hooks post-approval)
	 * 2. Run PostToolUse hooks (if enabled) - cannot block, only observe
	 * 3. Add hook context modifications to the conversation
	 * 4. Update focus chain tracking
	 *
	 * Note: PreToolUse hooks are now executed by individual tool handlers after approval
	 * and before the actual tool operation. This provides better UX as approval dialogs
	 * appear immediately without hook execution delay.
	 *
	 * PostToolUse hooks are for observation/logging only and cannot block.
	 *
	 * @param block The complete tool use block with all parameters
	 * @param config The task configuration containing all necessary context
	 */

	/**
	 * Re-render a partial tool block through the UI helpers.
	 * Used when the stream identity of a partial block changes (e.g. stable block index).
	 *
	 * @param block The tool use block to re-render. Must be partial.
	 */
	public async reRenderPartialBlock(block: ToolUse, _existingTs?: number): Promise<void> {
		if (this.taskState.abort || this.taskController.wasRejected(block.call_id || "")) return
		if (!block.partial) return
		if (!this.coordinator.has(block.name)) return
		const handler = this.coordinator.getHandler(block.name)
		if (!handler || !("handlePartialBlock" in handler)) return
		try {
			const config = this.asToolConfig()
			const uiHelpers = createUIHelpers(config)
			await (handler as IPartialBlockHandler).handlePartialBlock(block, uiHelpers)
		} catch (error) {
			Logger.error(`[reRenderPartialBlock] ${block.name}:`, error)
		}
	}
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check abort flag at the very start to prevent execution after cancellation
		if (this.taskState.abort) {
			return
		}

		const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))

		// Track if we need to cancel after hooks complete
		let shouldCancelAfterHook = false

		let executionSuccess = true
		let toolResult: any = null
		let toolWasExecuted = false
		const executionStartTime = Date.now()

		try {
			// Final abort check immediately before tool execution
			if (this.taskState.abort) {
				return
			}

			// Block attempt_completion when focus chain is incomplete (other turn-ending tools remain available)
			const focusChainEnabled = this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled
			const fcChecklist = this.taskState.currentFocusChainChecklist
			if (
				block.name === ClineDefaultTool.ATTEMPT &&
				focusChainEnabled &&
				fcChecklist &&
				!isAllItemsCompleted(fcChecklist)
			) {
				const { getPrompt } = await import("../prompts/i18n")
				const blockMsg = getPrompt("focusChain", "attemptCompletionBlocked")
				const fullMsg = `${blockMsg}\n\nCurrent checklist:\n${fcChecklist}`
				toolResult = formatResponse.toolError(fullMsg)
				toolWasExecuted = true
				this.taskState.consecutiveMistakeCount++
			} else {
				// Execute the actual tool
				toolResult = await this.coordinator.execute(config, block)
			}
			toolWasExecuted = true
			this.pushToolResult(toolResult, block)
			await this.recordPartialToolResult(toolResult, block)

			// --- Repeated tool call loop detection ---
			// Must run BEFORE updating lastToolName/lastToolParams so we compare
			// against the previous call's values, not the current one.
			const currentSignature = toolCallSignature(block.params)
			const loopCheck = checkRepeatedToolCall(this.taskState, block.name, currentSignature)

			if (loopCheck.softWarning) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.repeatedToolCall(block.name, LOOP_DETECTION_SOFT_THRESHOLD),
				})
			}

			if (loopCheck.hardEscalation) {
				this.taskState.consecutiveMistakeCount = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
			}

			// Update state AFTER comparison
			this.taskState.lastToolName = block.name
			this.taskState.lastToolParams = currentSignature

			// Check abort before running PostToolUse hook (success path)
			if (this.taskState.abort) {
				return
			}

			// Run PostToolUse hook for successful tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(
					block,
					toolResult,
					executionSuccess,
					executionStartTime,
					hooksEnabled, // always true here - already checked by caller
				)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)

			// Check abort before running PostToolUse hook (error path)
			if (this.taskState.abort) {
				throw error
			}

			// Run PostToolUse hook for failed tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (toolWasExecuted && hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(
					block,
					toolResult,
					executionSuccess,
					executionStartTime,
					hooksEnabled, // always true here - already checked by caller
				)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}

			// Re-throw the error after PostToolUse completes
			throw error
		}

		// Early return if hook requested cancellation
		if (shouldCancelAfterHook) {
			return
		}

		// Handle focus chain updates
		if (!block.partial && this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}
	}
}
