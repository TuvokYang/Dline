import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { ApiHandler, ApiProviderInfo, buildApiHandler, resolveProviderFromProfile } from "@core/api"
import { ApiStream } from "@core/api/transform/stream"
import { AssistantMessageContent, parseAssistantMessageV2, TextStreamContent, ToolUse } from "@core/assistant-message"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@core/context/context-management/context-error-handling"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { shouldDeferCurrentTurn } from "@core/context/context-management/current-turn-compaction"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import {
	getGlobalClineRules,
	getLocalClineRules,
	refreshClineRulesToggles,
} from "@core/context/instructions/user-instructions/cline-rules"
import {
	getLocalAgentsRules,
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { findEnabledProfileByName } from "@core/controller/file/getApiProfiles"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { getHookModelContext } from "@core/hooks/hook-model-context"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import * as NotificationHook from "@core/hooks/notification-hook"
import { executePreCompactHookWithCleanup, HookCancellationError, HookExecution } from "@core/hooks/precompact-executor"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { parseMentions } from "@core/mentions"
import { CommandPermissionController } from "@core/permissions"
import { summarizeTask } from "@core/prompts/contextManagement"
import { formatResponse } from "@core/prompts/responses"
import { parseSlashCommands } from "@core/slash-commands"
import {
	appendDebugRequestContext,
	ensureRulesDirectoryExists,
	ensureTaskDirectoryExists,
	GlobalFileNames,
	getSavedApiConversationHistory,
	getSavedClineMessages,
} from "@core/storage/disk"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { buildCheckpointManager, shouldUseMultiRoot } from "@integrations/checkpoints/factory"
import { ensureCheckpointInitialized } from "@integrations/checkpoints/initializer"
import { TaskFileTracker } from "@integrations/checkpoints/TaskFileTracker"
import { ICheckpointManager } from "@integrations/checkpoints/types"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { formatContentBlockToMarkdown } from "@integrations/misc/export-markdown"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ITerminalManager } from "@integrations/terminal/types"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { featureFlagsService } from "@services/feature-flags"
import { listFiles } from "@services/glob/list-files"
import { McpHub } from "@services/mcp/McpHub"
import { ApiConfiguration, DEFAULT_API_PROVIDER } from "@shared/api"
import { findLast, findLastIndex } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { ClineApiReqCancelReason, ClineApiReqInfo, ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import { isFocusChainItem } from "@shared/focus-chain-utils"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, LanguageDisplay } from "@shared/Languages"
import { USER_CONTENT_TAGS } from "@shared/messages/constants"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { ClineDefaultTool, READ_ONLY_TOOLS } from "@shared/tools"
import { ClineAskResponse } from "@shared/WebviewMessage"
import {
	isClaude4PlusModelFamily,
	isGPT5ModelFamily,
	isLocalModel,
	isNextGenModelFamily,
	isParallelToolCallingEnabled,
} from "@utils/model-utils"
import { arePathsEqual, getDesktopDir } from "@utils/path"
import { filterExistingFiles } from "@utils/tabFiltering"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import Mutex from "p-mutex"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { ulid } from "ulid"
import type { SystemPromptContext } from "@/core/prompts/system-prompt"
import { getSystemPrompt } from "@/core/prompts/system-prompt"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import {
	type CommandExecutionOptions,
	CommandExecutor,
	CommandExecutorCallbacks,
	FullCommandExecutorConfig,
	StandaloneTerminalManager,
} from "@/integrations/terminal"
import { ClineErrorType, ErrorService } from "@/services/error"
import { telemetryService } from "@/services/telemetry"
import { ClineClient } from "@/shared/cline"
import {
	ClineAssistantContent,
	ClineAssistantToolUseBlock,
	ClineContent,
	ClineImageContentBlock,
	ClineMessageModelInfo,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineToolResponseContent,
	ClineUserContent,
	ClineUserToolResultContentBlock,
} from "@/shared/messages"
import { ShowMessageType } from "@/shared/proto/dline/host"
import { ApiFormat } from "@/shared/proto/dline/models"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { RuleContextBuilder } from "../context/instructions/user-instructions/RuleContextBuilder"
import { ensureLocalClineDirExists } from "../context/instructions/user-instructions/rule-helpers"
import { discoverAvailableSkills } from "../context/instructions/user-instructions/skills"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { Controller } from "../controller"
import { refreshSkills } from "../controller/file/refreshSkills"
import { executeHook } from "../hooks/hook-executor"
import { StateManager } from "../storage/StateManager"
import {
	isTurnEndingToolName,
	isTurnEndingToolUse,
	orderTurnEndingContentBlocks,
	orderTurnEndingNativeToolBlocks,
} from "./assistant-message-order"
import { FocusChainManager } from "./focus-chain"
import {
	getPresentationCadenceMs,
	isPresentationSchedulingDisabled,
	isRemoteWorkspaceEnvironment,
	type TaskLatencyTrigger,
} from "./latency"
import { MessageChannel } from "./MessageChannel"
import { MessageStateHandler } from "./message-state"
import { advanceLifecycle, getDeferredToolAction } from "./partial-tool-lifecycle"
import type { PresentationPriority } from "./presentation-types"
import { type PendingToolUseState, type ReplayOptions, RestoreHandler } from "./RestoreHandler"
import { ResumeHandler } from "./ResumeHandler"
import { StreamChunkCoordinator } from "./StreamChunkCoordinator"
import { StreamResponseHandler } from "./StreamResponseHandler"
import { TaskController } from "./TaskController"
import { TaskPhase } from "./TaskPhase"
import { TaskPresentationScheduler } from "./TaskPresentationScheduler"
import { isValidApiIndex, type TaskSnapshot } from "./TaskSnapshot"
import { TaskSnapshotPersistence } from "./TaskSnapshotPersistence"
import { findAnchoredAsk } from "./TaskSnapshotReplayer"
import { TaskState } from "./TaskState"
import { TaskStateManager } from "./TaskStateManager"
import { withTerminateTimeout } from "./TaskTerminateTimeout"
import { ToolExecutor } from "./ToolExecutor"
import { detectAvailableCliTools, updateApiReqMsg } from "./utils"
import { buildUserFeedbackContent } from "./utils/buildUserFeedbackContent"

export type ToolResponse = ClineToolResponseContent

type TaskParams = {
	controller: Controller
	mcpHub: McpHub
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	postStateToWebview: (options?: { immediate?: boolean }) => Promise<void>
	reinitExistingTaskFromId: (taskId: string) => Promise<void>
	cancelTask: () => Promise<void>
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	defaultTerminalProfile: string
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	task?: string
	images?: string[]
	files?: string[]
	historyItem?: HistoryItem
	taskId: string
	uiMessage?: import("../storage/UIMessage").UIMessage
	apiConversation?: import("../storage/ApiConversation").ApiConversation
}

type ResumeTaskFromHistoryOptions = {
	onReadyToDisplay?: () => Promise<void>
}

type AskOptions = {
	onAskVisible?: (askTs: number) => Promise<void> | void
	/** If provided, update the existing ask message with this ts instead of creating a new partial */
	existingTs?: number
	/** Called when a new partial ask message is created with a new ts */
	onTsCreated?: (ts: number) => void
	/** ts of the associated command message (for command_output) */
	commandTs?: number
}

/**
 * Cached approval response replayed from history when resuming pending tools.
 */
type PendingToolUseApprovalResponse = {
	type: ClineAsk
	response: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
}

export class Task {
	// Core task variables
	readonly taskId: string
	readonly ulid: string
	private taskIsFavorited?: boolean
	private cwd: string
	private taskInitializationStartTime: number

	taskState: TaskState
	taskController: TaskController

	// ONE mutex for ALL state modifications to prevent race conditions
	private stateMutex = new Mutex()

	/**
	 * Execute function with exclusive lock on all task state
	 * Use this for ANY state modification to prevent races
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	/**
	 * Atomically set active hook execution with mutex protection
	 * Prevents TOCTOU races when setting hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async setActiveHookExecution(hookExecution: NonNullable<typeof this.taskState.activeHookExecution>): Promise<void> {
		await this.withStateLock(() => {
			this.taskState.activeHookExecution = hookExecution
		})
	}

	/**
	 * Atomically clear active hook execution with mutex protection
	 * Prevents TOCTOU races when clearing hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async clearActiveHookExecution(): Promise<void> {
		await this.withStateLock(() => {
			this.taskState.activeHookExecution = undefined
		})
	}

	/**
	 * Atomically read active hook execution state with mutex protection
	 * Returns a snapshot of the current state to prevent TOCTOU races
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async getActiveHookExecution(): Promise<typeof this.taskState.activeHookExecution> {
		return await this.withStateLock(() => {
			return this.taskState.activeHookExecution
		})
	}

	// Core dependencies
	private controller: Controller
	private mcpHub: McpHub
	private _mcpNotificationCb?: (serverName: string, level: string, message: string) => Promise<void>

	// Service handlers
	api: ApiHandler
	terminalManager: ITerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	public checkpointManager?: ICheckpointManager
	private initialCheckpointCommitPromise?: Promise<string | undefined>
	private clineIgnoreController: ClineIgnoreController
	private commandPermissionController: CommandPermissionController
	private toolExecutor: ToolExecutor
	/**
	 * Whether the task is using native tool calls.
	 * This is used to determine how we would format response.
	 * Example: We don't add noToolsUsed response when native tool call is used
	 * because of the expected format from the tool calls is different.
	 */
	private useNativeToolCalls = false
	private streamHandler: StreamResponseHandler

	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private taskFileTracker: TaskFileTracker
	private modelContextTracker: ModelContextTracker
	private environmentContextTracker: EnvironmentContextTracker

	// Focus Chain
	private FocusChainManager?: FocusChainManager

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: (options?: { immediate?: boolean }) => Promise<void>
	private reinitExistingTaskFromId: (taskId: string) => Promise<void>
	private cancelTask: () => Promise<void>

	// Cache service
	private stateManager: StateManager
	public taskSm: TaskStateManager

	// Message and conversation state
	messageStateHandler: MessageStateHandler

	// Workspace manager
	workspaceManager?: WorkspaceRootManager

	// Command executor for running shell commands (extracted from executeCommandTool)
	private commandExecutor!: CommandExecutor
	private isRemoteWorkspaceEnvironment = false
	private remoteWorkspaceDetectionSettled = false
	private readonly remoteWorkspaceDetectionPromise: Promise<void>
	private readonly presentationScheduler: TaskPresentationScheduler
	private readonly snapshotPersistence: TaskSnapshotPersistence
	private readonly presentationSchedulingDisabled = isPresentationSchedulingDisabled()
	private lastLoggedPresentationTrigger = 0
	/** @deprecated Only used by the deprecated promptAndResumePendingToolUseFromHistory path. */
	private pendingToolUseApprovalResponse?: PendingToolUseApprovalResponse
	restoreHandler!: RestoreHandler
	resumeHandler!: ResumeHandler

	constructor(params: TaskParams) {
		const {
			controller,
			mcpHub,
			updateTaskHistory,
			postStateToWebview,
			reinitExistingTaskFromId,
			cancelTask,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager,
			workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			uiMessage,
			apiConversation,
		} = params

		this.taskInitializationStartTime = performance.now()
		this.taskState = new TaskState()
		this.remoteWorkspaceDetectionPromise = HostProvider.env
			.getHostVersion({})
			.then((hostVersion: any) => {
				this.isRemoteWorkspaceEnvironment = isRemoteWorkspaceEnvironment(hostVersion)
			})
			.catch((error: any) => {
				Logger.warn(`[Task ${taskId}] Failed to detect remote workspace state: ${error}`)
			})
			.finally(() => {
				this.remoteWorkspaceDetectionSettled = true
			})
		this.controller = controller
		this.mcpHub = mcpHub
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.reinitExistingTaskFromId = reinitExistingTaskFromId
		this.cancelTask = cancelTask
		this.clineIgnoreController = new ClineIgnoreController(cwd)
		this.commandPermissionController = new CommandPermissionController()
		// Determine terminal execution mode and create appropriate terminal manager
		this.terminalExecutionMode = vscodeTerminalExecutionMode || "vscodeTerminal"

		// When backgroundExec mode is selected, use StandaloneTerminalManager for hidden execution
		// Otherwise, use the HostProvider's terminal manager (VSCode terminal in VSCode, standalone in CLI)
		if (this.terminalExecutionMode === "backgroundExec") {
			// Import StandaloneTerminalManager for background execution
			this.terminalManager = new StandaloneTerminalManager()
			Logger.info(`[Task ${taskId}] Using StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Use the host-provided terminal manager (VSCode terminal in VSCode environment)
			this.terminalManager = HostProvider.get().createTerminalManager()
			Logger.info(`[Task ${taskId}] Using HostProvider terminal manager for vscodeTerminal mode`)
		}
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher()
		this.browserSession = new BrowserSession(stateManager)
		this.contextManager = new ContextManager()
		this.streamHandler = new StreamResponseHandler(() => this.genMessageTs())
		this.cwd = cwd
		this.stateManager = stateManager
		this.taskSm = new TaskStateManager(taskId, stateManager)
		this.workspaceManager = workspaceManager

		// DiffViewProvider opens Diff Editor during edits while FileEditProvider performs
		// edits in the background without stealing user's editor's focus.
		const backgroundEditEnabled = this.stateManager.getGlobalSettingsKey("backgroundEditEnabled")
		this.diffViewProvider = backgroundEditEnabled ? new FileEditProvider() : HostProvider.get().createDiffViewProvider()

		this.taskId = taskId
		this.snapshotPersistence = new TaskSnapshotPersistence({
			writeSnapshot: this.writeTaskSnapshot.bind(this),
		})

		// Initialize taskId first
		if (historyItem) {
			this.ulid = historyItem.ulid ?? ulid()
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			if (historyItem.checkpointManagerErrorMessage) {
				this.taskState.checkpointManagerErrorMessage = historyItem.checkpointManagerErrorMessage
			}
		} else if (task || images || files) {
			this.ulid = ulid()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
			uiMessage,
			apiConversation,
		})

		// Create MessageChannel (message engine) and TaskController (central hub)
		const channel = new MessageChannel({
			pushMessage: (msg) => sendPartialMessageEvent(this.controller, convertClineMessageToProto(msg)),
			syncState: async () => {
				await this.postStateToWebview()
			},
			messageStateHandler: this.messageStateHandler,
			taskState: this.taskState,
			getProviderInfo: () => {
				const info = this.getCurrentProviderInfo()
				return { providerId: info.providerId, modelId: info.model.id, mode: info.mode }
			},
			genTs: () => this.genMessageTs(),
		})
		this.taskController = new TaskController(channel)

		// Initialize context trackers
		this.fileContextTracker = new FileContextTracker(controller, this.taskId)
		this.taskFileTracker = new TaskFileTracker(this.taskId)
		this.modelContextTracker = new ModelContextTracker(this.taskId)
		this.environmentContextTracker = new EnvironmentContextTracker(this.taskId)

		// Initialize focus chain manager only if enabled
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		if (focusChainSettings.enabled) {
			this.FocusChainManager = new FocusChainManager({
				taskId: this.taskId,
				taskState: this.taskState,
				mode: this.taskSm.mode,
				stateManager: this.stateManager,
				postStateToWebview: this.postStateToWebview,
				say: this.say.bind(this),
				focusChainSettings: focusChainSettings,
			})
		}

		// Initialize resume/restore handlers
		this.restoreHandler = new RestoreHandler({
			taskState: this.taskState,
			controller: this.taskController,
			messageStateHandler: this.messageStateHandler,
			checkpointManager: this.checkpointManager,
			presentAssistantMessage: this.presentAssistantMessage.bind(this),
			recursivelyMakeClineRequests: this.recursivelyMakeClineRequests.bind(this),
			postStateToWebview: this.postStateToWebview,
			shouldAutoApproveTool: (toolName: string, _callId: string) => {
				return this.toolExecutor?.isAutoApproved(toolName as any) ?? false
			},
		})

		this.resumeHandler = new ResumeHandler({
			taskState: this.taskState,
			controller: this.taskController,
			messageStateHandler: this.messageStateHandler,
			restoreHandler: this.restoreHandler,
			setPendingApprovalResponse: (resp) => {
				this.pendingToolUseApprovalResponse = resp
			},
			ask: this.ask.bind(this),
			say: this.say.bind(this),
			postStateToWebview: this.postStateToWebview,
		})

		// Check for multiroot workspace and warn about checkpoints
		const isMultiRootWorkspace = this.workspaceManager && this.workspaceManager.getRoots().length > 1
		const checkpointsEnabled = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")

		if (isMultiRootWorkspace && checkpointsEnabled) {
			// Set checkpoint manager error message to display warning in TaskHeader
			this.taskState.checkpointManagerErrorMessage = "Checkpoints are not currently supported in multi-root workspaces."
		}

		// Initialize checkpoint manager based on workspace configuration
		if (!isMultiRootWorkspace) {
			try {
				this.checkpointManager = buildCheckpointManager({
					taskId: this.taskId,
					controller: this.controller,
					messageStateHandler: this.messageStateHandler,
					fileContextTracker: this.fileContextTracker,
					diffViewProvider: this.diffViewProvider,
					taskState: this.taskState,
					taskFileTracker: this.taskFileTracker,
					workspaceManager: this.workspaceManager,
					updateTaskHistory: this.updateTaskHistory,
					say: this.say.bind(this),
					cancelTask: this.cancelTask,
					postStateToWebview: this.postStateToWebview,
					initialConversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					initialCheckpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
					stateManager: this.stateManager,
				})

				// If multi-root, kick off non-blocking initialization
				// Unreachable for now, leaving in for future multi-root checkpoint support
				if (
					shouldUseMultiRoot({
						workspaceManager: this.workspaceManager,
						enableCheckpoints: this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting"),
						stateManager: this.stateManager,
					})
				) {
					this.checkpointManager.initialize?.().catch((error: Error) => {
						Logger.error("Failed to initialize multi-root checkpoint manager:", error)
						this.taskState.checkpointManagerErrorMessage = error?.message || String(error)
					})
				}
			} catch (error) {
				Logger.error("Failed to initialize checkpoint manager:", error)
				if (this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Failed to initialize checkpoint manager: ${errorMessage}`,
					})
				}
			}
		}

		// Prepare effective API configuration
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const mode = this.taskSm.mode

		// Establish task-level overrides for profile names
		if (apiConfiguration.planModeProfile) {
			this.stateManager.setTaskSettings(this.taskId, "planModeProfile", apiConfiguration.planModeProfile)
		}
		if (apiConfiguration.actModeProfile) {
			this.stateManager.setTaskSettings(this.taskId, "actModeProfile", apiConfiguration.actModeProfile)
		}

		const effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
			onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: any) => {
				const clineMessages = this.messageStateHandler.clineMessages
				const lastApiReqStartedIndex = findLastIndex(clineMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					try {
						const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[lastApiReqStartedIndex].text || "{}")
						currentApiReqInfo.retryStatus = {
							attempt: attempt, // attempt is already 1-indexed from retry.ts
							maxAttempts: maxRetries, // total attempts
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						}
						// Clear previous cancelReason and streamingFailedMessage if we are retrying
						delete currentApiReqInfo.cancelReason
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateClineMessage(lastApiReqStartedIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})

						// Post the updated state to the webview so the UI reflects the retry attempt
						await this.postStateToWebview().catch((e) =>
							Logger.error("Error posting state to webview in onRetryAttempt:", e),
						)
					} catch (e) {
						Logger.error(`[Task ${this.taskId}] Error updating api_req_started with retryStatus:`, e)
					}
				}
			},
		}
		const currentProfile = mode === "plan" ? apiConfiguration.planModeProfile : apiConfiguration.actModeProfile
		const currentProvider = resolveProviderFromProfile(currentProfile) || DEFAULT_API_PROVIDER

		// Now that ulid is initialized, we can build the API handler
		this.api = buildApiHandler(effectiveApiConfiguration, mode)

		// Set ulid on browserSession for telemetry tracking
		this.browserSession.setUlid(this.ulid)

		// Note: Task initialization (startTask/displayHistory/resumeFromHistory) is now called
		// from Controller.initTask() AFTER the task instance is fully assigned.
		// This prevents race conditions where hooks run before controller.task is ready.

		// Set up focus chain file watcher + load history (async, runs in background) only if focus chain is enabled
		if (this.FocusChainManager) {
			this.FocusChainManager.setupFocusChainFileWatcher().catch((error) => {
				Logger.error(`[Task ${this.taskId}] Failed to setup focus chain file watcher:`, error)
			})
			this.FocusChainManager.readFocusChainHistory()
				.then((history) => {
					if (history) {
						this.taskState.focusChainHistory = history
					}
				})
				.catch((error) => {
					Logger.error(`[Task ${this.taskId}] Failed to load focus chain history:`, error)
				})
		}

		// initialize telemetry

		// Extract domain of the provider endpoint if using OpenAI Compatible provider.
		// Provider-specific baseUrl is now sourced from profile resolver at runtime.
		// Domain extraction is deferred — telemetry will record "unknown" for openai-compatible.
		let openAiCompatibleDomain: string | undefined
		if (currentProvider === "openai") {
			openAiCompatibleDomain = undefined
		}

		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.ulid, currentProvider, openAiCompatibleDomain)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.ulid, currentProvider, openAiCompatibleDomain)
		}

		// Initialize command executor with config and callbacks
		const commandExecutorConfig: FullCommandExecutorConfig = {
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			terminalManager: this.terminalManager,
			taskId: this.taskId,
			ulid: this.ulid,
		}

		const commandExecutorCallbacks: CommandExecutorCallbacks = {
			say: this.say.bind(this) as CommandExecutorCallbacks["say"],
			ask: async (type: string, text?: string, partial?: boolean, options?: { commandTs?: number }) => {
				const result = await this.ask(type as ClineAsk, text, partial, options as any)
				return {
					response: result.response,
					text: result.text,
					images: result.images,
					files: result.files,
				}
			},
			resolvePendingAsk: (response) => {
				void this.handleWebviewAskResponse(response as ClineAskResponse)
			},
			updateBackgroundCommandState: (isRunning: boolean) =>
				this.controller.updateBackgroundCommandState(isRunning, this.taskId),
			updateClineMessage: async (
				index: number,
				updates: { text?: string; exitCode?: number; commandStatus?: "pending" | "running" | "completed" | "skipped" },
			) => {
				await this.messageStateHandler.updateClineMessage(index, updates)
				// Notify frontend so the sliding window reflects updated fields (e.g. commandStatus, exitCode)
				const updatedMessage = this.messageStateHandler.clineMessages[index]
				if (updatedMessage) {
					await sendPartialMessageEvent(this.controller, convertClineMessageToProto(updatedMessage))
				}
			},
			getClineMessages: () => this.messageStateHandler.clineMessages as Array<{ ask?: string; say?: string }>,
			addToUserMessageContent: (content: { type: string; text: string }) => {
				// Cast to ClineTextContentBlock which is compatible with ClineContent
				this.taskState.userMessageContent.push({ type: "text", text: content.text } as ClineTextContentBlock)
			},
		}

		this.commandExecutor = new CommandExecutor(commandExecutorConfig, commandExecutorCallbacks)

		// Note: the scheduler's getDelayMs reads this.isRemoteWorkspaceEnvironment which is
		// populated asynchronously by remoteWorkspaceDetectionPromise. The promise is awaited
		// before streaming begins (in recursivelyMakeClineRequests) so the cadence is always
		// correct by the time the first flush is scheduled.
		this.presentationScheduler = new TaskPresentationScheduler({
			flush: async () => {
				try {
					await this.presentAssistantMessage()
				} catch (error) {
					if (this.taskState.abort && error instanceof Error && error.message === "Dline instance aborted") {
						Logger.debug(`[Task ${taskId}] presentAssistantMessage flush skipped after abort: ${error.message}`)
					} else {
						Logger.error(`[Task ${taskId}] presentAssistantMessage flush failed:`, error)
					}
					throw error
				}
			},
			getDelayMs: (priority) => {
				if (!this.remoteWorkspaceDetectionSettled) {
					// This should never fire in production because recursivelyMakeClineRequests
					// awaits remoteWorkspaceDetectionPromise before the first flush is scheduled.
					// If it does fire, we fall back to the local cadence (safe default).
					Logger.warn(
						`[Task ${taskId}] getDelayMs called before remote workspace detection settled ÃƒÂ¢Ã¢â€?using local cadence as fallback`,
					)
				}
				return getPresentationCadenceMs(this.isRemoteWorkspaceEnvironment, priority)
			},
			onFlushError: (error) => Logger.debug(`[Task] Failed scheduled presentation flush: ${error}`),
		})

		this.toolExecutor = new ToolExecutor(
			this.taskState,
			this.taskController,
			this.messageStateHandler,
			this.api,
			this.urlContentFetcher,
			this.browserSession,
			this.diffViewProvider,
			this.mcpHub,
			this.fileContextTracker,
			this.taskFileTracker,
			this.clineIgnoreController,
			this.commandPermissionController,
			this.contextManager,
			this.stateManager,
			cwd,
			this.taskId,
			this.ulid,
			this.terminalExecutionMode,
			this.workspaceManager,
			isMultiRootEnabled(this.stateManager),
			this.say.bind(this),
			this.ask.bind(this),
			this.saveCheckpointCallback.bind(this),
			this.sayAndCreateMissingParamError.bind(this),
			this.executeCommandTool.bind(this),
			this.cancelBackgroundCommand.bind(this),
			() => this.checkpointManager?.doesLatestTaskCompletionHaveNewChanges() ?? Promise.resolve(false),
			this.createWrappedFCUpdateCallback(),
			(newPlan: string) => this.FocusChainManager?.forceReplaceFocusChain(newPlan) ?? Promise.resolve(),
			this.switchToActModeCallback.bind(this),
			this.cancelTask,
			// Atomic hook state helpers for ToolExecutor
			this.setActiveHookExecution.bind(this),
			this.clearActiveHookExecution.bind(this),
			this.getActiveHookExecution.bind(this),
			this.runUserPromptSubmitHook.bind(this),
			commandExecutorCallbacks.updateClineMessage,
		)

		// Inject controller context for spawn_task to create new webview panels
		;(this.toolExecutor as any)._controllerContext = this.controller?.context
	}

	/**
	 * Rebuild the API handler at runtime (for mid-task model switching).
	 * Profile-driven: planModeProfile/actModeProfile already stores the profile name.
	 */
	public rebuildApiHandler(): void {
		const mode = this.taskSm.mode
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const effectiveConfig: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
		}
		this.api = buildApiHandler(effectiveConfig, mode)
		// Sync per-task profile cache so getCurrentProviderInfo reads the correct value
		const currentProfile = mode === "plan" ? effectiveConfig.planModeProfile : effectiveConfig.actModeProfile
		if (currentProfile) {
			if (mode === "plan") {
				this.taskSm.setPlanModeProfile(currentProfile)
			} else {
				this.taskSm.setActModeProfile(currentProfile)
			}
		}
		// Update toolExecutor's api reference so tool handlers use the new handler
		if (this.toolExecutor) {
			;(this.toolExecutor as any).api = this.api
		}
	}

	private async scheduleAssistantPresentation(
		trigger: TaskLatencyTrigger,
		priority: PresentationPriority = "normal",
	): Promise<void> {
		if (this.presentationSchedulingDisabled) {
			// Scheduling is disabled: preserve the old per-chunk synchronisation
			// semantics by awaiting flushNow() directly, while still routing through
			// the scheduler so its serialisation/locking guarantees are respected.
			await this.presentationScheduler.flushNow().catch((error) => {
				Logger.warn(`[Task] Failed immediate presentation flush: ${error}`)
			})
			return
		}

		// Only log when trigger or priority changes to avoid log spam during streaming
		const currentSecond = Math.floor(Date.now() / 1000)
		if (this.lastLoggedPresentationTrigger !== currentSecond) {
			this.lastLoggedPresentationTrigger = currentSecond
			Logger.debug(`[Task ${this.taskId}] schedule assistant presentation (${trigger}, ${priority})`)
		}
		this.presentationScheduler.requestFlush(priority)
	}

	private async flushAssistantPresentationOrThrow() {
		await this.presentationScheduler.flushNow()
	}

	private getPresentationPriorityForChunk(args: {
		chunkType: "text" | "reasoning" | "tool_calls"
		hadVisibleAssistantContent: boolean
	}): PresentationPriority {
		if (!args.hadVisibleAssistantContent) {
			return "immediate"
		}

		if (args.chunkType === "tool_calls") {
			return "immediate"
		}

		return "normal"
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		options?: AskOptions,
	): Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
		askTs?: number
	}> {
		const askOptions = this.withApprovalVisibleCallback(type, text, partial, options)

		// Handle pending approval response (replayed from history) before delegating
		const pendingApprovalResponse = this.pendingToolUseApprovalResponse
		if (pendingApprovalResponse && pendingApprovalResponse.type === type && partial === false) {
			this.pendingToolUseApprovalResponse = undefined
			const result = await this.taskController.ask(type, text, partial, askOptions)
			return result
		}

		const result = await this.taskController.ask(type, text, partial, askOptions)

		return result
	}

	/**
	 * Tool names for conversational ask types whose handlers internally
	 * call ask() and expect messageResponse as a normal user response.
	 * For these tools, messageResponse must NOT trigger rejectActiveBlock,
	 * otherwise subsequent conversational tools in the same turn get
	 * cascaded SKIPPED and the task loop deadlocks.
	 */
	private static readonly CONVERSATIONAL_TOOL_NAMES = new Set([
		"qna_respond",
		"plan_mode_respond",
		"act_mode_respond",
		"ask_followup_question",
		"generate_report",
	])

	async handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[], files?: string[]) {
		this.taskController.resolveAsk(askResponse, text, images, files)

		// Conversational tools (qna_respond, plan_mode_respond, etc.) handle
		// user responses internally via their handler's ask(). The block phase
		// machine must NOT treat messageResponse as a rejection for these tools,
		// otherwise subsequent conversational tools in the same turn get
		// cascaded SKIPPED and the task loop deadlocks.
		const activeBlock = this.taskController.getActiveBlock()
		if (activeBlock && Task.CONVERSATIONAL_TOOL_NAMES.has(activeBlock.toolName)) {
			return
		}

		// Update the approval state machine based on the user's response
		if (askResponse === "noButtonClicked" || askResponse === "messageResponse") {
			const rejected = this.taskController.rejectActiveBlock()
			if (rejected) {
				this.taskController.transition(TaskPhase.BETWEEN_TURNS, {
					apiIndex: rejected.conversationHistoryIndex,
					onSnapshot: this.emitStateSnapshot.bind(this),
				})
				await this.flushTaskSnapshot()
				await this.postStateToWebview()
			}
		} else if (askResponse === "yesButtonClicked") {
			const executing = this.taskController.completeActiveBlock()
			if (executing) {
				this.taskController.transition(TaskPhase.EXECUTING, {
					apiIndex: executing.conversationHistoryIndex,
					execution: {
						mode: this.isParallelToolCallingEnabled() ? "parallel" : "serial",
						executing: [executing.callId],
					},
					onSnapshot: this.emitStateSnapshot.bind(this),
				})
				await this.flushTaskSnapshot()
				await this.postStateToWebview()
			}
		}
	}

	/** Monotonic message ts generator to avoid same-ms collisions */
	private lastGeneratedMessageTs = 0

	/**
	 * Generate a unique message timestamp (ms). Guarantees monotonic increase
	 * for all ClineMessage.ts values while preserving millisecond semantics.
	 */
	private genMessageTs(): number {
		const maxExistingTs = this.messageStateHandler.clineMessages.reduce((max, m) => Math.max(max, m.ts), 0)
		const currentMax = Math.max(maxExistingTs, this.taskState.lastMessageTs ?? 0, this.lastGeneratedMessageTs)
		const ts = Math.max(Date.now(), currentMax + 1)
		this.lastGeneratedMessageTs = ts
		return ts
	}

	/**
	 * Add or update a "say" message in the chat.
	 *
	 * @param type The type of the message (ClineSay)
	 * @param text The message text (optional)
	 * @param images Image URIs (optional)
	 * @param files File paths (optional)
	 * @param partial Whether this message is a partial/streaming update (optional)
	 * @param existingTs If provided, update the existing message with this ts instead of adding a new one
	 * @returns The ts of the added or updated message, or undefined if updated in place
	 */
	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		existingTs?: number,
		commandTs?: number,
	): Promise<number | undefined> {
		return this.taskController.say(type, text, images, files, partial, existingTs, commandTs)
	}

	async sayAndCreateMissingParamError(toolName: ClineDefaultTool, paramName: string, relPath?: string, existingTs?: number) {
		await this.say(
			"error",
			`Dline tried to use ${toolName}${
				relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
			undefined,
			undefined,
			false,
			existingTs,
		)
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	/**
	 * Persist a state snapshot as a state_snapshot message in ui_messages.jsonl.
	 * Called via TaskController.transition() onSnapshot callback on every phase change.
	 * Frontend filters these messages — they are not rendered to the user.
	 */
	private async emitStateSnapshot(snapshot: TaskSnapshot): Promise<void> {
		try {
			this.snapshotPersistence.schedule(snapshot)

			// Also persist as state_snapshot message in ui_messages.jsonl (existing behavior)
			await this.say("state_snapshot", JSON.stringify(snapshot))
		} catch (error) {
			Logger.error("[emitStateSnapshot] Failed to persist state snapshot:", error)
		}
	}

	/**
	 * Atomically writes the latest task snapshot to snapshot.json.
	 * @param snapshot Snapshot generated by the task phase machine.
	 */
	private async writeTaskSnapshot(snapshot: TaskSnapshot): Promise<void> {
		const taskDir = await ensureTaskDirectoryExists(this.taskId)
		const snapshotPath = path.join(taskDir, GlobalFileNames.taskSnapshot)
		const tmpPath = `${snapshotPath}.tmp.${Date.now()}`
		await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf8")
		await fs.rename(tmpPath, snapshotPath)
	}

	/**
	 * Forces any pending snapshot.json update to disk before a critical lifecycle boundary.
	 */
	private async flushTaskSnapshot(): Promise<void> {
		try {
			await this.snapshotPersistence.flushNow()
		} catch (error) {
			Logger.error("[flushTaskSnapshot] Failed to persist task snapshot:", error)
		}
	}

	/**
	 * Get a valid apiIndex from a snapshot, falling back to the last index in
	 * apiConversationHistory when the snapshot's apiIndex is invalid (negative
	 * or out of bounds). Uses isValidApiIndex() to avoid the ?? trap where
	 * -1 is treated as a valid number.
	 */
	private getValidSnapshotApiIndex(snapshot?: TaskSnapshot): number {
		const historyLen = this.messageStateHandler.apiConversationHistory.length
		if (snapshot && isValidApiIndex(snapshot.apiIndex, historyLen)) {
			return snapshot.apiIndex
		}
		return historyLen - 1
	}

	public findLatestStateSnapshot(): TaskSnapshot | undefined {
		let latest: { snapshot: TaskSnapshot; order: number; timestamp: number } | undefined
		const messages = this.messageStateHandler.clineMessages

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]
			if (message.type !== "say" || message.say !== "state_snapshot" || !message.text) {
				continue
			}
			try {
				const snapshot = JSON.parse(message.text) as TaskSnapshot
				const timestamp = typeof snapshot.timestamp === "number" ? snapshot.timestamp : message.ts
				if (!latest || timestamp > latest.timestamp || (timestamp === latest.timestamp && i > latest.order)) {
					latest = { snapshot, order: i, timestamp }
				}
			} catch {
				// Ignore corrupt snapshots.
			}
		}

		return latest?.snapshot
	}

	/**
	 * Replays UI messages after the latest snapshot to find a still-active ask.
	 * @param snapshot Snapshot checkpoint loaded from the UI message stream.
	 * @returns Active ask message, or undefined when tail messages consumed it.
	 */
	private findSnapshotAnchoredMessage(snapshot?: TaskSnapshot): ClineMessage | undefined {
		return findAnchoredAsk(snapshot, this.messageStateHandler.clineMessages)
	}

	private findLegacyResumeAnchorMessage(): ClineMessage | undefined {
		return this.messageStateHandler.clineMessages
			.slice()
			.reverse()
			.find(
				(m) =>
					!(
						m.ask === "resume_task" ||
						m.ask === "resume_completed_task" ||
						m.say === "partial_tool_result" ||
						m.say === "task_progress" ||
						m.say === "state_snapshot"
					),
			)
	}

	private async saveCheckpointCallback(isAttemptCompletionMessage?: boolean, completionMessageTs?: number): Promise<void> {
		return this.checkpointManager?.saveCheckpoint(isAttemptCompletionMessage, completionMessageTs) ?? Promise.resolve()
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model/provider supports native tool calling and handles parallel tools well
	 */
	private isParallelToolCallingEnabled(): boolean {
		const enableParallelSetting = this.stateManager.getGlobalSettingsKey("enableParallelToolCalling")
		const providerInfo = this.getCurrentProviderInfo()
		return isParallelToolCallingEnabled(enableParallelSetting, providerInfo)
	}

	private async switchToActModeCallback(): Promise<boolean> {
		return await this.controller.toggleActModeForYoloMode()
	}

	/**
	 * Creates a wrapped focus chain update callback that also syncs the
	 * editor tab title with the latest task progress.
	 *
	 * @returns An async function matching updateFCListFromToolResponse signature
	 */
	private createWrappedFCUpdateCallback(): (taskProgress: string | undefined) => Promise<void> {
		const baseCallback: (taskProgress: string | undefined) => Promise<void> = this.FocusChainManager
			? this.FocusChainManager.updateFCListFromToolResponse.bind(this.FocusChainManager)
			: async (_taskProgress: string | undefined) => {}
		return async (taskProgress: string | undefined) => {
			await baseCallback(taskProgress)
			// Sync panel title after focus chain update
			this.syncPanelTitleFromState()
		}
	}

	/**
	 * Syncs the editor tab title based on current task state.
	 * Uses the task description and focus chain progress for the title.
	 */
	private syncPanelTitleFromState(): void {
		try {
			// Get the first task message text as the base title
			const msgs = this.messageStateHandler.clineMessages
			const taskMsg = msgs.find((m) => m.say === "task")
			let title = taskMsg?.text || "Dline"

			// Append focus chain progress if available (e.g. "Task (3/5)")
			const checklist = this.taskState.currentFocusChainChecklist
			if (checklist) {
				const { parseFocusChainListCounts } = require("./focus-chain/utils")
				const { totalItems, completedItems } = parseFocusChainListCounts(checklist)
				if (totalItems > 0) {
					title = `${title} (${completedItems}/${totalItems})`
				}
			}

			void this.controller.syncPanelTitle(title)
		} catch {
			// Non-critical; silently skip
		}
	}

	/**
	 * Unified cancellation handler for hook-requested cancellations.
	 * Ensures state is always saved before aborting, regardless of whether
	 * the user clicked cancel or the hook returned {cancel: true}.
	 *
	 * @param hookName The name of the hook for logging
	 * @param wasCancelled Whether user clicked cancel (vs hook returning cancel: true)
	 */
	private async handleHookCancellation(hookName: string, wasCancelled: boolean): Promise<void> {
		// ALWAYS save state, regardless of cancellation source
		this.taskState.didFinishAbortingStream = true

		// Save conversation state to disk
		await this.messageStateHandler.updateTaskHistory()
		await this.messageStateHandler.flushApiConversationHistory()
		await this.messageStateHandler.flushUiMessages()

		// Update UI
		await this.postStateToWebview()

		// Log for debugging/telemetry
		Logger.log(`[Task ${this.taskId}] ${hookName} hook cancelled (userInitiated: ${wasCancelled})`)
	}

	/**
	 * Calculate the new deleted range for PreCompact hook
	 * @param apiConversationHistory The full API conversation history
	 * @returns Tuple with start and end indices for the deleted range
	 */
	private calculatePreCompactDeletedRange(apiConversationHistory: ClineStorageMessage[]): [number, number] {
		const newDeletedRange = this.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation on error
		)

		return newDeletedRange || [0, 0]
	}

	private async runUserPromptSubmitHook(
		userContent: ClineContent[],
		_context: "initial_task" | "resume" | "feedback",
	): Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }> {
		const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))

		if (!hooksEnabled) {
			return {}
		}

		const { extractUserPromptFromContent } = await import("./utils/extractUserPromptFromContent")

		// Extract clean user prompt from content, stripping system wrappers and metadata
		const promptText = extractUserPromptFromContent(userContent)

		const userPromptResult = await executeHook({
			hookName: "UserPromptSubmit",
			hookInput: {
				userPromptSubmit: {
					prompt: promptText,
					attachments: [],
				},
			},
			isCancellable: true,
			say: this.say.bind(this),
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled,
			model: getHookModelContext(this.api, this.stateManager),
		})

		// Handle cancellation from hook
		if (userPromptResult.cancel === true && userPromptResult.wasCancelled) {
			// Set flag to allow Controller.cancelTask() to proceed
			this.taskState.didFinishAbortingStream = true
			// Save BOTH files so Controller.cancelTask() can find the task
			await this.messageStateHandler.updateTaskHistory()
			await this.messageStateHandler.flushApiConversationHistory()
			await this.messageStateHandler.flushUiMessages()
			await this.postStateToWebview()
		}

		return {
			cancel: userPromptResult.cancel,
			contextModification: userPromptResult.contextModification,
			errorMessage: userPromptResult.errorMessage,
		}
	}

	// Task lifecycle

	public async startTask(task?: string, images?: string[], files?: string[], context?: string[]): Promise<void> {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ClineIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}
		// conversationHistory (for API) and clineMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the clineMessages might not be empty, so we need to set it to [] when we create a new Cline client (otherwise webview would show stale messages from previous session)
		await this.messageStateHandler.uiMessage?.clear()
		await this.messageStateHandler.apiConversation?.clear()

		await this.postStateToWebview()

		await this.say("task", task, images, files)

		this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
		})

		const imageBlocks: ClineImageContentBlock[] = formatResponse.imageBlocks(images)

		const userContent: ClineUserContent[] = [
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		]

		// Inject context blocks — each as independent text block for cache-friendly design.
		// Accepts string[] to support future auto-extraction of multiple context fragments.
		if (context && context.length > 0) {
			for (const ctx of context) {
				userContent.push({ type: "text", text: `<context>\n${ctx}\n</context>` })
			}
		}

		if (files && files.length > 0) {
			const fileContentString = await processFilesIntoText(files)
			if (fileContentString) {
				userContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Add TaskStart hook context to the conversation if provided
		const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))
		if (hooksEnabled) {
			const taskStartResult = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: this.taskId,
							ulid: this.ulid,
							initialTask: task || "",
						},
					},
				},
				isCancellable: true,
				say: this.say.bind(this),
				setActiveHookExecution: this.setActiveHookExecution.bind(this),
				clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
				model: getHookModelContext(this.api, this.stateManager),
			})

			// Handle cancellation from hook
			if (taskStartResult.cancel === true) {
				// Always save state regardless of cancellation source
				await this.handleHookCancellation("TaskStart", taskStartResult.wasCancelled)

				// Let Controller handle the cancellation (it will call abortTask)
				await this.cancelTask()
				return
			}

			// Add context modification to the conversation if provided
			if (taskStartResult.contextModification) {
				const contextText = taskStartResult.contextModification.trim()
				if (contextText) {
					userContent.push({
						type: "text",
						text: `<hook_context source="TaskStart">\n${contextText}\n</hook_context>`,
					})
				}
			}
		}

		// Defensive check: Verify task wasn't aborted during hook execution before continuing
		// Must be OUTSIDE the hooksEnabled block to prevent UserPromptSubmit from running
		if (this.taskState.abort) {
			return
		}

		// Run UserPromptSubmit hook for initial task (after TaskStart for UI ordering)
		const userPromptHookResult = await this.runUserPromptSubmitHook(userContent, "initial_task")

		// Defensive check: Verify task wasn't aborted during hook execution (handles async cancellation)
		if (this.taskState.abort) {
			return
		}

		// Handle hook cancellation
		if (userPromptHookResult.cancel === true) {
			await this.handleHookCancellation("UserPromptSubmit", userPromptHookResult.wasCancelled ?? false)
			await this.cancelTask()
			return
		}

		// Add hook context if provided
		if (userPromptHookResult.contextModification) {
			userContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		// Record environment metadata for new task
		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata:", error)
		}

		this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			onSnapshot: this.emitStateSnapshot.bind(this),
		})

		// Mark task as initialized so checkpoint restore can proceed
		this.taskState.isInitialized = true

		await this.initiateTaskLoop(userContent)
	}

	/**
	 * @deprecated Use ResumeHandler.detectPendingTools() instead.
	 * Legacy pending-tool detection — replaced by the snapshot-aware ResumeHandler.
	 * Only kept for backward reference; new code should use ResumeHandler.
	 */
	private getPendingToolUseState(apiConversationHistory: ClineStorageMessage[]): PendingToolUseState | undefined {
		// Collect partial_tool_result records, keyed by conversationHistoryIndex
		const partialResultsByIndex = new Map<number, Map<string, string>>()
		for (const m of this.messageStateHandler.clineMessages) {
			if (m.say === "partial_tool_result" && m.text && m.conversationHistoryIndex !== undefined) {
				try {
					const parsed = JSON.parse(m.text)
					if (parsed.tool_use_id && parsed.result) {
						const idx = m.conversationHistoryIndex
						if (!partialResultsByIndex.has(idx)) {
							partialResultsByIndex.set(idx, new Map())
						}
						partialResultsByIndex.get(idx)?.set(parsed.tool_use_id, parsed.result)
					}
				} catch {
					// Skip malformed records
				}
			}
		}
		// DEBUG: log all partial_tool_result indices and tool_use_ids
		if (partialResultsByIndex.size > 0) {
			const keys = [...partialResultsByIndex.keys()].join(",")
			const details = [...partialResultsByIndex.entries()].map(([k, v]) => `${k}:[${[...v.keys()].join(",")}]`).join(" | ")
			Logger.debug(`[resume] partialResultsByIndex keys=[${keys}] details=${details}`)
		} else {
			Logger.debug(`[resume] partialResultsByIndex is EMPTY`)
		}

		for (let i = apiConversationHistory.length - 1; i >= 0; i--) {
			const message = apiConversationHistory[i]
			if (message.role !== "assistant" || !Array.isArray(message.content)) {
				continue
			}

			const toolUseBlocks = message.content.filter(
				(block): block is ClineAssistantToolUseBlock =>
					block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string",
			)
			if (toolUseBlocks.length === 0) {
				continue
			}

			const nextMessage = apiConversationHistory[i + 1]
			const answeredToolUseIds = new Set<string>()
			const answeredToolResults: ClineUserToolResultContentBlock[] = []
			if (nextMessage?.role === "user" && Array.isArray(nextMessage.content)) {
				for (const block of nextMessage.content) {
					if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
						answeredToolUseIds.add(block.tool_use_id)
						answeredToolResults.push(block)
					}
				}
			}

			// Merge partial_tool_result records for this assistant turn
			// Step 1: filter by conversationHistoryIndex
			const turnPartialResults = partialResultsByIndex.get(i)
			Logger.debug(
				`[resume] assistantIndex=${i} nextMsgRole=${nextMessage?.role} nextHasToolResult=${answeredToolUseIds.size > 0} turnPartialExists=${turnPartialResults !== undefined} turnPartialSize=${turnPartialResults?.size ?? 0} blockIds=${toolUseBlocks.map((b) => b.id).join(",")}`,
			)
			// Step 2: match each tool_use block by tool_use_id within filtered results
			for (const block of toolUseBlocks) {
				if (!answeredToolUseIds.has(block.id) && turnPartialResults) {
					const resultText = turnPartialResults.get(block.id)
					Logger.debug(`[resume] match attempt block.id=${block.id} found=${resultText !== undefined}`)
					if (resultText) {
						answeredToolUseIds.add(block.id)
						answeredToolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: [{ type: "text", text: resultText }],
						})
					}
				}
			}

			const pendingToolUseBlocks = toolUseBlocks.filter(
				(block) => !answeredToolUseIds.has(block.id) && !isTurnEndingToolName(block.name),
			)
			if (pendingToolUseBlocks.length === 0) {
				Logger.debug(`[resume] no pending tools at assistantIndex=${i}`)
				return undefined
			}
			Logger.debug(
				`[resume] assistantIndex=${i} toolUseBlocks=${toolUseBlocks.length} answered=${answeredToolUseIds.size} pending=${pendingToolUseBlocks.length} pendingNames=${pendingToolUseBlocks.map((b) => b.name).join(",")}`,
			)

			// Find existing ask ts for the first pending tool
			let lastPendingAskTs: number | undefined
			if (pendingToolUseBlocks.length > 0) {
				const askType = TaskController.toolNameToAskType(pendingToolUseBlocks[0].name)
				if (askType) {
					const msgs = this.messageStateHandler.clineMessages
					const existing = [...msgs].reverse().find((m) => m.type === "ask" && m.ask === askType)
					lastPendingAskTs = existing?.ts
				}
			}

			return {
				assistantIndex: i,
				toolUseBlocks: pendingToolUseBlocks,
				answeredToolResults,
				sanitizedHistory: apiConversationHistory.slice(0, i + 1),
				lastPendingAskTs,
			}
		}

		return undefined
	}

	/**
	 * @deprecated Only called by promptAndResumePendingToolUseFromHistory (deprecated).
	 * Stale ask cleanup for the legacy resume path.
	 */
	private async removeStalePendingToolResumeAsks() {
		const pendingToolAskTypes = new Set<ClineAsk>([
			"followup",
			"plan_mode_respond",
			"act_mode_respond",
			"command",
			"tool",
			"browser_action_launch",
			"use_mcp_server",
			"new_task",
			"condense",
			"summarize_task",
			"report_bug",
			"use_subagents",
			"spawn_task",
		])
		const clineMessages = this.messageStateHandler.clineMessages
		const staleAskIndices = new Set<number>()
		const stalePendingToolAskIndex = findLastIndex(
			clineMessages,
			(message) =>
				message.type === "ask" &&
				!!message.ask &&
				pendingToolAskTypes.has(message.ask) &&
				!(message as any).commandStatus,
		)
		if (stalePendingToolAskIndex !== -1) {
			staleAskIndices.add(stalePendingToolAskIndex)
		}

		const staleApiFailureAskIndex = findLastIndex(
			clineMessages,
			(message) => message.type === "ask" && message.ask === "api_req_failed",
		)
		if (staleApiFailureAskIndex !== -1) {
			staleAskIndices.add(staleApiFailureAskIndex)
		}

		if (staleAskIndices.size > 0) {
			const staleTs = [...staleAskIndices].sort((a, b) => a - b).map((index) => clineMessages[index].ts)
			await this.messageStateHandler.removeMessagesByTs(staleTs)
		}
	}

	private isPendingToolApprovalAsk(ask: ClineAsk | undefined): ask is ClineAsk {
		return (
			ask === "tool" ||
			ask === "command" ||
			ask === "browser_action_launch" ||
			ask === "use_mcp_server" ||
			ask === "use_subagents" ||
			ask === "spawn_task" ||
			ask === "focus_chain_change" ||
			ask === "status_acknowledgment"
		)
	}

	/**
	 * Check if an ask type is conversational (Q&A / plan / report).
	 * These tools display a text response in the footer without approve/reject buttons and
	 * expect a text reply via the input box. They must set conversation awaiting in the
	 * snapshot so buildTaskUiState returns cancelEnabled=false and no action buttons.
	 */
	private isConversationalAsk(ask: ClineAsk | undefined): ask is ClineAsk {
		return (
			ask === "plan_mode_respond" ||
			ask === "qna_respond" ||
			ask === "followup" ||
			ask === "generate_report" ||
			ask === "act_mode_respond"
		)
	}

	/**
	 * Check if an ask type represents error recovery.
	 * These asks must be projected through TaskUiState instead of legacy buttonConfig.
	 */
	private isErrorRecoveryAsk(ask: ClineAsk | undefined): ask is ClineAsk {
		return ask === "api_req_failed" || ask === "mistake_limit_reached"
	}

	/**
	 * Check if an ask type represents a resumable paused task.
	 * These asks must set awaiting.resume so history and cancel recovery show Resume.
	 */
	private isResumeAsk(ask: ClineAsk | undefined): ask is ClineAsk {
		return ask === "resume_task" || ask === "resume_completed_task"
	}

	private withApprovalVisibleCallback(
		type: ClineAsk,
		text: string | undefined,
		partial: boolean | undefined,
		options?: AskOptions,
	): AskOptions | undefined {
		const shouldTrackApproval = this.isPendingToolApprovalAsk(type) && partial !== true
		const shouldTrackConversation = this.isConversationalAsk(type) && partial !== true
		const shouldTrackErrorRecovery = this.isErrorRecoveryAsk(type) && partial !== true
		const shouldTrackResume = this.isResumeAsk(type) && partial !== true
		const shouldNotify = type !== "command_output" && partial !== true
		if (
			!shouldTrackApproval &&
			!shouldTrackConversation &&
			!shouldTrackErrorRecovery &&
			!shouldTrackResume &&
			!shouldNotify
		) {
			return options
		}

		return {
			...options,
			onAskVisible: async (askTs: number) => {
				if (shouldTrackApproval) {
					await this.markApprovalAskVisible(type)
				}
				if (shouldTrackConversation) {
					await this.markConversationAskVisible(type, askTs)
				}
				if (shouldTrackErrorRecovery) {
					await this.markErrorRecoveryAskVisible(type, askTs, text)
				}
				if (shouldTrackResume) {
					await this.markResumeAskVisible(type, askTs)
				}
				await options?.onAskVisible?.(askTs)
				if (shouldNotify) {
					try {
						await NotificationHook.emitUserAttentionNotification(
							{
								messageStateHandler: this.messageStateHandler,
								taskId: this.taskId,
								hooksEnabled: getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled")),
								model: getHookModelContext(this.api, this.stateManager),
							},
							{
								source: type,
								message: text || "",
							},
						)
					} catch (error) {
						Logger.error("[Task.ask] Failed to emit user attention notification:", error)
					}
				}
			},
		}
	}

	private async markApprovalAskVisible(type: ClineAsk): Promise<void> {
		const block = this.taskController.getActiveBlock() ?? this.taskController.advanceNextPendingApproval()
		if (!block) return

		const expectedAsk = this.taskController.toolNameToAskType(block.toolName)
		if (expectedAsk !== type) return

		await this.taskController.transition(TaskPhase.AWAITING_APPROVAL, {
			apiIndex: block.conversationHistoryIndex,
			awaiting: {
				kind: type === "status_acknowledgment" ? "approval" : "approval",
				taskAsk: type,
				activeCallId: block.callId,
			},
			approval: {
				mode: this.isParallelToolCallingEnabled() ? "parallel" : "serial",
				blocks: this.taskController.getBlocks().map((candidate) => ({
					callId: candidate.callId,
					name: candidate.toolName,
					phase: candidate.phase,
					apiIndex: candidate.conversationHistoryIndex,
				})),
				activeCallId: block.callId,
			},
			onSnapshot: this.emitStateSnapshot.bind(this),
		})
		await this.postStateToWebview()
	}

	/**
	 * Create a conversation-awaiting snapshot for Q&A tools (plan_mode_respond,
	 * qna_respond, followup, generate_report, act_mode_respond).
	 * This ensures buildTaskUiState returns cancelEnabled=false and empty actions,
	 * so the frontend hides the Cancel button and shows only the input area.
	 */
	private async markConversationAskVisible(type: ClineAsk, askTs: number): Promise<void> {
		await this.taskController.transition(TaskPhase.AWAITING_APPROVAL, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			awaiting: {
				kind: "conversation",
				taskAsk: type,
				messageTs: askTs,
			},
			onSnapshot: this.emitStateSnapshot.bind(this),
		})
		await this.postStateToWebview()
	}

	/**
	 * Create an error-recovery snapshot for retry/process-anyway asks.
	 * This keeps footer actions and input enabled state driven by TaskUiState.
	 */
	private async markErrorRecoveryAskVisible(type: ClineAsk, askTs: number, message?: string): Promise<void> {
		const isApiRequestFailure = type === "api_req_failed"
		await this.taskController.transition(TaskPhase.AWAITING_APPROVAL, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			awaiting: {
				kind: "error_recovery",
				taskAsk: type,
				messageTs: askTs,
			},
			error: {
				kind: isApiRequestFailure ? "api_req_failed" : "mistake_limit_reached",
				sourceAsk: type,
				message: message ?? "",
				actions: isApiRequestFailure ? ["retry", "start_new_task"] : ["process_anyway", "start_new_task"],
				retryable: isApiRequestFailure,
				processAllowed: !isApiRequestFailure,
				messageTs: askTs,
			},
			onSnapshot: this.emitStateSnapshot.bind(this),
		})
		await this.postStateToWebview()
	}

	/**
	 * Create a resume-awaiting snapshot for paused or historical task recovery.
	 * This ensures Resume is shown instead of Cancel while no work is active.
	 */
	private async markResumeAskVisible(type: ClineAsk, askTs: number): Promise<void> {
		await this.taskController.transition(TaskPhase.PAUSED, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			awaiting: {
				kind: "resume",
				taskAsk: type,
				messageTs: askTs,
			},
			onSnapshot: this.emitStateSnapshot.bind(this),
		})
		await this.postStateToWebview()
	}

	/**
	 * @deprecated Use ResumeHandler.resumeFromHistory() instead.
	 * Legacy prompt-and-resume flow — replaced by the snapshot-aware ResumeHandler + RestoreHandler.
	 * Only kept for backward reference; new code should use ResumeHandler.
	 */
	private async promptAndResumePendingToolUseFromHistory(
		pendingToolUse: PendingToolUseState,
		lastClineMessage: ClineMessage | undefined,
		options?: ResumeTaskFromHistoryOptions,
	) {
		let approvalAsk: ClineAsk | undefined
		if (pendingToolUse.toolUseBlocks.length > 0) {
			approvalAsk = TaskController.toolNameToAskType(pendingToolUse.toolUseBlocks[0].name)
		}

		// Skip focus_chain_change if already approved (plan has prefix markers [+] or [-])
		if (approvalAsk === "focus_chain_change" && lastClineMessage?.text) {
			try {
				const data = JSON.parse(lastClineMessage.text)
				if (/\[\+\]|\[-\]/.test(data.plan || "")) {
					approvalAsk = undefined
				}
			} catch {}
		}

		const askType = approvalAsk ?? "resume_task"
		const askText = approvalAsk ? lastClineMessage?.text : undefined

		// Unified ts so step 1 (ask) and step 2 (tool_use block) reuse the
		// same message, preventing duplicate UI rendering on resume.
		// Skip lastPendingAskTs if it belongs to a message that was already
		// rejected/skipped — reusing its ts would set commandStatus:"pending"
		// on a previously rejected message (Bug: stale Cancel button).
		let toolAskTs: number | undefined
		if (approvalAsk) {
			if (pendingToolUse.lastPendingAskTs !== undefined) {
				const oldMsg = this.messageStateHandler.clineMessages.find((m) => m.ts === pendingToolUse.lastPendingAskTs)
				const hasStatus = oldMsg && (oldMsg as any).commandStatus
				toolAskTs = hasStatus ? this.genMessageTs() : pendingToolUse.lastPendingAskTs
			} else {
				toolAskTs = this.genMessageTs()
			}
		}
		Logger.debug(
			`[resume] promptAndResume askType=${askType} approvalAsk=${approvalAsk} lastPendingAskTs=${pendingToolUse.lastPendingAskTs} toolAskTs=${toolAskTs} lastClineMsgType=${lastClineMessage?.type} lastClineMsgAsk=${lastClineMessage?.ask}`,
		)

		this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			onSnapshot: this.emitStateSnapshot.bind(this),
		})
		this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			onSnapshot: this.emitStateSnapshot.bind(this),
		})

		this.taskController.transition(TaskPhase.RESUMING, {
			apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
			resume: pendingToolUse
				? {
						assistantApiIndex: pendingToolUse.assistantIndex,
						pendingToolUseIds: pendingToolUse.toolUseBlocks.map((b) => b.id),
						answeredToolUseIds: pendingToolUse.answeredToolResults.map((r: any) => r.tool_use_id),
					}
				: undefined,
		})

		const { response, text, images, files } = await this.ask(askType, askText, undefined, {
			onAskVisible: options?.onReadyToDisplay,
			existingTs: toolAskTs,
		})

		// If user rejected the resume prompt, skip tool execution entirely.
		// Without this check, resumePendingToolUseFromHistory would execute
		// all pending tools regardless of the user's choice.
		if (response === "noButtonClicked") {
			this.taskController.rejectActiveBlock()
			return
		}

		if (approvalAsk) {
			await this.removeStalePendingToolResumeAsks()
		}

		const resumeUserContent: TaskState["userMessageContent"] = []
		if (approvalAsk) {
			this.pendingToolUseApprovalResponse = {
				type: approvalAsk,
				response,
				text,
				images,
				files,
			}
		} else if (text || (images && images.length > 0) || (files && files.length > 0)) {
			await this.say("user_feedback", text, images, files)

			if (text) {
				resumeUserContent.push({
					type: "text",
					text: `<user_response>\n${text}\n</user_response>`,
				})
			}
			if (images && images.length > 0) {
				resumeUserContent.push(...formatResponse.imageBlocks(images))
			}
			if (files && files.length > 0) {
				const fileContentString = await processFilesIntoText(files)
				if (fileContentString) {
					resumeUserContent.push({
						type: "text",
						text: fileContentString,
					})
				}
			}
		}

		await this.resumePendingToolUseFromHistory(pendingToolUse, { resumeUserContent, baseTs: toolAskTs })
	}

	/**
	 * @deprecated Use RestoreHandler.replayPendingTools() directly.
	 * Thin wrapper that delegates to restoreHandler. Only kept for legacy callers.
	 */
	private async resumePendingToolUseFromHistory(pendingToolUse: PendingToolUseState, options?: ReplayOptions) {
		await this.restoreHandler.replayPendingTools(pendingToolUse, options)
	}

	/**
	 * Load and display historical task messages without waiting for user interaction.
	 * Does NOT clean old resume messages or api_req_started â€?those are handled by
	 * resumeFromHistory() when the task is interactively resumed.
	 *
	 * Used for both readonly (locked task) and interactive resume scenarios.
	 */
	public async displayHistory(): Promise<void> {
		try {
			await this.clineIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ClineIgnoreController:", error)
		}

		const savedClineMessages = await getSavedClineMessages(this.taskId)
		await this.messageStateHandler.uiMessage?.overwrite(savedClineMessages)
		await this.messageStateHandler.updateTaskHistory()

		const savedApiConversationHistory = await getSavedApiConversationHistory(this.taskId)
		this.messageStateHandler.apiConversationHistory = savedApiConversationHistory

		await ensureTaskDirectoryExists(this.taskId)
		await this.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.taskId))

		// Hydrate machines from latest snapshot for accurate state restoration
		const latestSnapshot = this.findLatestStateSnapshot()
		if (latestSnapshot) {
			this.restoreHandler.hydrateFromSnapshot(latestSnapshot)
		}

		// Mark task as initialized so checkpoint restore can proceed
		this.taskState.isInitialized = true
	}

	/**
	 * Interactively resume a task after displayHistory() has loaded messages.
	 * Cleans stale resume/partial messages, determines the appropriate ask type,
	 * waits for user interaction via this.ask(), executes hooks, and starts the
	 * task loop.
	 *
	 * Only call this when the task lock is acquired (taskLockAcquired === true).
	 * Readonly windows should stop after displayHistory() and show a lock banner.
	 */
	public async resumeFromHistory(options?: ResumeTaskFromHistoryOptions) {
		// Clean messages that were loaded by displayHistory() in preparation
		// for a fresh interactive resume.
		const clineMessages = this.messageStateHandler.clineMessages

		// Remove any resume messages that may have been added before
		const lastRelevantMessageIndex = findLastIndex(
			clineMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			await this.messageStateHandler.uiMessage?.truncateByLineNum(lastRelevantMessageIndex + 1)
		}

		// Remove incomplete api_req_started (no cost, no cancelReason) —
		// indicates an API request without any partial content streamed
		const truncatedMsgs = this.messageStateHandler.clineMessages
		const lastApiReqStartedIndex = findLastIndex(truncatedMsgs, (m) => m.type === "say" && m.say === "api_req_started")
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = truncatedMsgs[lastApiReqStartedIndex]
			const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
			if (cost === undefined && cancelReason === undefined) {
				await this.messageStateHandler.uiMessage?.deleteAt(lastApiReqStartedIndex)
			}
		}

		// Clean up any residual partial:true messages from a previously interrupted
		// task so the frontend does not show a stale Cancel button on history load.
		this.messageStateHandler.uiMessage?.clearPartialFlags()

		// Single task history update for all above operations
		await this.messageStateHandler.updateTaskHistory()

		await this.flushTaskSnapshot()

		const snapshot = this.findLatestStateSnapshot()
		const lastClineMessage = this.findSnapshotAnchoredMessage(snapshot) ?? this.findLegacyResumeAnchorMessage()
		const currentMessages = this.messageStateHandler.clineMessages

		// Show a resume affordance for any incomplete historical task. Once a task
		// is loaded from disk there is no live ask promise to consume responses
		// from an old tool/followup/api state, so we create a fresh resume ask.
		const lastApiReqMsg = findLast(currentMessages, (m) => m.say === "api_req_started")
		let wasCancelled = false
		if (lastApiReqMsg?.text) {
			try {
				const info: ClineApiReqInfo = JSON.parse(lastApiReqMsg.text)
				wasCancelled = info.cancelReason !== undefined
			} catch {}
		}

		// Unified resume path: ResumeHandler (phase-aware, snapshot-based)
		// Covers both new-state-snapshot and legacy tasks (detectPendingTools falls back internally)
		const pendingResumed = await this.resumeHandler.resumeFromHistory(lastClineMessage)
		if (pendingResumed) return

		let askType: ClineAsk | undefined
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else if (lastClineMessage?.ask) {
			// Preserve the original ask type so the user sees the same
			// question/approval UI (qna_respond, followup, plan_mode_respond,
			// tool, etc.) instead of a generic "Resume Task" button.
			askType = lastClineMessage.ask
		} else if (wasCancelled) {
			askType = "resume_task"
		} else if (lastClineMessage) {
			askType = "resume_task"
		} else {
			// Historical task with only state messages — show resume affordance
			askType = "resume_task"
		}

		if (!askType) {
			// No ask type means the task is complete with no resume affordance needed.
			const staleApiReqIndices: number[] = []
			for (let i = 0; i < currentMessages.length; i++) {
				const m = currentMessages[i]
				if (m.type !== "say" || m.say !== "api_req_started" || !m.text) {
					continue
				}
				try {
					const info = JSON.parse(m.text)
					if (info.cost == null && info.cancelReason == null && info.streamingFailedMessage == null) {
						staleApiReqIndices.push(i)
					}
				} catch {
					staleApiReqIndices.push(i)
				}
			}
			if (staleApiReqIndices.length > 0) {
				const staleTs = staleApiReqIndices.map((i) => currentMessages[i].ts)
				await this.messageStateHandler.removeMessagesByTs(staleTs)
			}
			this.taskController.transition(TaskPhase.STREAMING, {
				apiIndex: this.getValidSnapshotApiIndex(snapshot),
				onSnapshot: this.emitStateSnapshot.bind(this),
			})
			this.taskState.abort = true
			await this.postStateToWebview({ immediate: true })
			await options?.onReadyToDisplay?.()
			return
		}

		await this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.getValidSnapshotApiIndex(snapshot),
			onSnapshot: this.emitStateSnapshot.bind(this),
		})

		if (askType === "plan_mode_respond") {
			this.taskState.isAwaitingPlanResponse = true
		}

		// Remove the old ask message of the same type to avoid duplicates
		const isConversationalAsk = askType === "plan_mode_respond" || askType === "qna_respond" || askType === "followup"
		if (isConversationalAsk) {
			const msgs = this.messageStateHandler.clineMessages
			const oldAskIndex = findLastIndex(
				msgs,
				(m) => m.type === "ask" && m.ask === askType && (!lastClineMessage?.ask || m.ts === lastClineMessage.ts),
			)
			if (oldAskIndex !== -1) {
				await this.messageStateHandler.uiMessage?.deleteAt(oldAskIndex)
			}
		}

		const askText = isConversationalAsk ? lastClineMessage?.text : undefined
		const { response, text, images, files } = await this.ask(askType, askText, undefined, {
			onAskVisible: options?.onReadyToDisplay,
			existingTs: lastClineMessage?.ask ? lastClineMessage?.ts : undefined,
		})

		// Run UserPromptSubmit hook before delegating to resumeTask (which doesn't include it)
		const hasUserResponse =
			response === "messageResponse" || text || (images && images.length > 0) || (files && files.length > 0)
		if (hasUserResponse) {
			const userFeedbackContent = await buildUserFeedbackContent(text, images, files)
			const userPromptHookResult = await this.runUserPromptSubmitHook(userFeedbackContent, "resume")
			if (this.taskState.abort) return
			if (userPromptHookResult.cancel === true) {
				await this.cancelTask()
				return
			}
		}

		// PLAN_MODE_TOGGLE_RESPONSE is a technical signal — skip user_feedback and start loop directly
		const isToggleSignal = text === "PLAN_MODE_TOGGLE_RESPONSE"
		if (isToggleSignal) {
			await this.messageStateHandler.overwriteApiConversationHistory(this.messageStateHandler.apiConversationHistory)
			await this.initiateTaskLoop([])
			return
		}

		// Delegate to resumeTask for unified post-ask processing
		await this.resumeTask({ response, text, images, files })
	}

	/**
	 * Resume the current task without reloading messages from disk.
	 * Used after cancellation so the message list stays in-place (no flicker)
	 * while still showing the resume prompt and handling the user response.
	 */
	public async resumeTask(preObtainedResponse?: {
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}) {
		await this.flushTaskSnapshot()

		const snapshot = this.findLatestStateSnapshot()

		// Reset abort state so ask() and subsequent operations work
		this.taskState.abort = false
		await this.taskController.transition(TaskPhase.STREAMING, {
			apiIndex: this.getValidSnapshotApiIndex(snapshot),
			onSnapshot: this.emitStateSnapshot.bind(this),
		})

		// Clean up any residual partial:true messages from a previously interrupted
		// task so the frontend does not show a stale Cancel button.
		this.messageStateHandler.uiMessage?.clearPartialFlags()

		// Unified resume path: ResumeHandler covers both new and legacy tasks
		const pendingResumed = await this.resumeHandler.resumeFromHistory()
		if (pendingResumed) return

		const lastClineMessage = this.findSnapshotAnchoredMessage(snapshot) ?? this.findLegacyResumeAnchorMessage()

		let askType: ClineAsk
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else if (lastClineMessage?.ask) {
			// Preserve the original ask type so the user sees the same
			// question/approval UI instead of a generic "Resume Task" button.
			askType = lastClineMessage.ask
		} else {
			askType = "resume_task"
		}

		let response: ClineAskResponse
		let text: string | undefined
		let images: string[] | undefined
		let files: string[] | undefined

		if (preObtainedResponse) {
			response = preObtainedResponse.response
			text = preObtainedResponse.text
			images = preObtainedResponse.images
			files = preObtainedResponse.files
		} else {
			Logger.debug(`[resumeTask] askType=${askType}`)
			const askResult = await this.ask(askType)
			response = askResult.response
			text = askResult.text
			images = askResult.images
			files = askResult.files
		}

		// --- Below is the same post-ask logic as resumeFromHistory ---

		const newUserContent: ClineContent[] = []

		const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))
		if (hooksEnabled) {
			const clineMessages = this.messageStateHandler.clineMessages
			const taskResumeResult = await executeHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: { taskId: this.taskId, ulid: this.ulid },
						previousState: {
							lastMessageTs: lastClineMessage?.ts?.toString() || "",
							messageCount: clineMessages.length.toString(),
							conversationHistoryDeleted: (this.taskState.conversationHistoryDeletedRange !== undefined).toString(),
						},
					},
				},
				isCancellable: true,
				say: this.say.bind(this),
				setActiveHookExecution: this.setActiveHookExecution.bind(this),
				clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
				model: getHookModelContext(this.api, this.stateManager),
			})

			if (taskResumeResult.cancel === true) {
				await this.handleHookCancellation("TaskResume", taskResumeResult.wasCancelled)
				await this.cancelTask()
				return
			}

			if (taskResumeResult.contextModification) {
				newUserContent.push({
					type: "text",
					text: `<hook_context source="TaskResume" type="general">\n${taskResumeResult.contextModification}\n</hook_context>`,
				})
			}
		}

		if (this.taskState.abort) return

		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === "messageResponse" || text || (images && images.length > 0) || (files && files.length > 0)) {
			await this.say("user_feedback", text, images, files)
			await this.checkpointManager?.saveCheckpoint()
			responseText = text
			responseImages = images
			responseFiles = files
		}

		const existingApiConversationHistory = this.messageStateHandler.apiConversationHistory
		let modifiedOldUserContent: ClineContent[]
		let modifiedApiConversationHistory: ClineStorageMessage[]
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: ClineContent[] = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				// If the last user message contains tool_result blocks, the
				// preceding assistant message's tool_use has already been
				// answered. Truncating this message via .slice(0, -1) would
				// cause getPendingToolUseState to misidentify the
				// tool as still pending, leading to duplicate UI messages
				// when the task is resumed.
				const hasToolResult =
					Array.isArray(lastMessage.content) &&
					lastMessage.content.some((block: ClineContent) => block.type === "tool_result")
				if (hasToolResult) {
					modifiedApiConversationHistory = [...existingApiConversationHistory]
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				}
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			modifiedApiConversationHistory = []
			modifiedOldUserContent = []
		}

		// Filter out tool_result blocks from previous content Ã¢â‚?		// they are already present in apiConversationHistory and
		// re-sending them would cause the AI to re-execute tools.
		const filteredOldContent = modifiedOldUserContent.filter((block) => (block as any).type !== "tool_result")
		newUserContent.push(...filteredOldContent)

		const agoText = (() => {
			const timestamp = lastClineMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)
			if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`
			if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`
			if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			return "just now"
		})()

		const wasRecent = lastClineMessage?.ts && Date.now() - lastClineMessage.ts < 30_000

		const pendingContextWarning = await this.fileContextTracker.retrieveAndClearPendingFileContextWarning()
		const hasPendingFileContextWarnings = pendingContextWarning && pendingContextWarning.length > 0

		const isResumption = askType === "resume_task" || askType === "resume_completed_task"
		if (isResumption) {
			const mode = this.taskSm.mode
			const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
				mode === "plan" ? "plan" : "act",
				agoText,
				this.cwd,
				wasRecent,
				responseText,
				hasPendingFileContextWarnings,
			)
			if (taskResumptionMessage !== "") {
				newUserContent.push({ type: "text", text: taskResumptionMessage })
			}
			if (userResponseMessage !== "") {
				newUserContent.push({ type: "text", text: userResponseMessage })
			}
		} else if (responseText) {
			// Reconstruct tool_result for unanswered turn-ending tools
			const lastApiMsg = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			const hasUnansweredToolUse =
				lastApiMsg?.role === "assistant" &&
				Array.isArray(lastApiMsg.content) &&
				lastApiMsg.content.some((block: any) => block.type === "tool_use" && isTurnEndingToolName(block.name))
			if (hasUnansweredToolUse) {
				const apiContent = lastApiMsg.content as ClineContent[]
				const toolUseBlocks = apiContent.filter(
					(block: any) => block.type === "tool_use" && isTurnEndingToolName(block.name),
				)
				const lastToolUse = toolUseBlocks[toolUseBlocks.length - 1]
				const toolUseId = (lastToolUse as any).id || (lastToolUse as any).call_id || ""
				const callId = (lastToolUse as any).call_id || toolUseId
				const resultText =
					(lastToolUse as any).name === "ask_followup_question"
						? `<answer>\n${responseText}\n</answer>`
						: `<user_message>\n${responseText}\n</user_message>`
				newUserContent.push({
					type: "tool_result",
					tool_use_id: toolUseId,
					call_id: callId,
					content: [{ type: "text", text: resultText }],
				} as any)
			} else {
				newUserContent.push({
					type: "text",
					text: `<user_response>\n${responseText}\n</user_response>`,
				})
			}
		}
		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}
		if (responseFiles && responseFiles.length > 0) {
			const fileContentString = await processFilesIntoText(responseFiles)
			if (fileContentString) {
				newUserContent.push({ type: "text", text: fileContentString })
			}
		}
		if (pendingContextWarning && pendingContextWarning.length > 0) {
			const fileContextWarning = formatResponse.fileContextWarning(pendingContextWarning)
			if (fileContextWarning) {
				newUserContent.push({ type: "text", text: fileContextWarning })
			}
		}

		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata on resume:", error)
		}

		await this.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent)
	}

	private async initiateTaskLoop(userContent: ClineContent[]): Promise<void> {
		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.taskState.abort) {
			const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // we only need file details the first time

			//  The way this agentic loop works is that cline will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if the user hits max requests and denies resetting the count.
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			}
			// this.say(
			// 	"tool",
			// 	"Cline responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
			// )
			nextUserContent = [
				{
					type: "text",
					text: formatResponse.noToolsUsed(this.useNativeToolCalls),
				},
			]
			this.taskState.consecutiveMistakeCount++
		}
	}

	/**
	 * Determines if the TaskCancel hook should run.
	 * Only runs if there's actual active work happening or if work was started in this session.
	 * Does NOT run when just showing the resume button or completion button with no active work.
	 * @returns true if the hook should run, false otherwise
	 */
	private async shouldRunTaskCancelHook(): Promise<boolean> {
		// Atomically check for active hook execution (work happening now)
		const activeHook = await this.getActiveHookExecution()
		if (activeHook) {
			return true
		}

		// Run if the API is currently streaming (work happening now)
		if (this.taskState.isStreaming) {
			return true
		}

		// Run if we're waiting for the first chunk (work happening now)
		if (this.taskState.isWaitingForFirstChunk) {
			return true
		}

		// Run if there's active background command (work happening now)
		if (this.commandExecutor.hasActiveBackgroundCommand()) {
			return true
		}

		// Check if we're at a button-only state (no active work, just waiting for user action)
		const clineMessages = this.messageStateHandler.clineMessages
		const lastMessage = clineMessages.at(-1)
		const isAtButtonOnlyState =
			lastMessage?.type === "ask" &&
			(lastMessage.ask === "resume_task" ||
				lastMessage.ask === "resume_completed_task" ||
				lastMessage.ask === "completion_result")

		if (isAtButtonOnlyState) {
			// At button-only state - DON'T run hook because we're just waiting for user input
			// These button states appear when:
			// 1. Opening from history (resume_task/resume_completed_task)
			// 2. After task completion (completion_result with "Start New Task" button)
			// 3. After cancelling during active work (but work already stopped)
			// In all cases, we shouldn't run TaskCancel hook
			return false
		}

		// Not at a button-only state - we're in the middle of work or just finished something
		// Run the hook since cancelling would interrupt actual work
		return true
	}

	/**
	 * Pause the task ÃƒÂ¢Ã¢â€?stop execution but preserve all resources.
	 * The task can be resumed later via resume().
	 * Called when the user clicks the cancel button.
	 */
	async abortExecution() {
		try {
			// PHASE 1: Check if TaskCancel should run BEFORE any cleanup
			const shouldRunTaskCancelHook = await this.shouldRunTaskCancelHook()

			// PHASE 2: Transition to PAUSED (recoverable) then CANCELLING
			await this.taskController.transition(TaskPhase.PAUSED, {
				apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
				onSnapshot: this.emitStateSnapshot.bind(this),
			})

			this.taskState.abort = true
			await this.taskController.transition(TaskPhase.CANCELLING, {
				apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
				cancel: { source: "user", fromPhase: TaskPhase.PAUSED },
				onSnapshot: this.emitStateSnapshot.bind(this),
			})

			// PHASE 3: Cancel any running hook execution
			const activeHook = await this.getActiveHookExecution()
			if (activeHook) {
				try {
					await this.cancelHookExecution()
					await this.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task pause", error)
					await this.clearActiveHookExecution()
				}
			}

			if (this.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await this.commandExecutor.cancelBackgroundCommand()
				} catch (error) {
					Logger.error("Failed to cancel background command during task pause", error)
				}
			}

			// PHASE 4: Run TaskCancel hook (conditional)
			const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))
			if (hooksEnabled && shouldRunTaskCancelHook) {
				try {
					await executeHook({
						hookName: "TaskCancel",
						hookInput: {
							taskCancel: {
								taskMetadata: {
									taskId: this.taskId,
									ulid: this.ulid,
									completionStatus: this.taskState.abandoned ? "abandoned" : "cancelled",
								},
							},
						},
						isCancellable: false,
						say: this.say.bind(this),
						messageStateHandler: this.messageStateHandler,
						taskId: this.taskId,
						hooksEnabled,
						model: getHookModelContext(this.api, this.stateManager),
					})
				} catch (error) {
					Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
				}
			}

			// Revert diff changes without disposing the provider
			await this.diffViewProvider.revertChanges()

			// Save state and update UI so the frontend reflects the pause
			await this.flushTaskSnapshot()
			await this.messageStateHandler.updateTaskHistory()
			await this.postStateToWebview()

			// Resume ask is now handled by cancelTask after pause completes.
			// This ensures the ask is sent with the final cleaned-up message list
			// and avoids a race between pause's async ask and cancelTask's postState.
		} catch (error) {
			Logger.error("[abortExecution] Failed:", error)
		}
	}

	/**
	 * Terminate the task completely ÃƒÂ¢Ã¢â€?dispose all resources and release locks.
	 * Called when the task is cleared, reset, or the extension is shutting down.
	 * No resume ask is sent because the task is being destroyed.
	 */
	async interrupt(): Promise<void> {
		this.taskState.abort = true
		this.api?.abort?.()

		await pWaitFor(() => !this.taskState.isStreaming || this.taskState.didFinishAbortingStream, {
			interval: 100,
			timeout: 3_000,
		}).catch(() => {})

		await this.diffViewProvider.revertChanges()
	}

	async terminate() {
		try {
			// PHASE 1: Check if TaskCancel should run BEFORE any cleanup
			const shouldRunTaskCancelHook = await this.shouldRunTaskCancelHook()

			// PHASE 2: Set abort flag
			this.taskState.abort = true
			this.taskController.transition(TaskPhase.CANCELLING, {
				apiIndex: this.messageStateHandler.apiConversationHistory.length - 1,
				cancel: { source: "user", fromPhase: this.taskController.phase },
				onSnapshot: this.emitStateSnapshot.bind(this),
			})

			// PHASE 3: Cancel hooks and background commands
			const activeHook = await this.getActiveHookExecution()
			if (activeHook) {
				try {
					await withTerminateTimeout(this.cancelHookExecution(), 5_000, "cancelHookExecution")
					await this.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task terminate", error)
					await this.clearActiveHookExecution()
				}
			}

			if (this.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await withTerminateTimeout(this.commandExecutor.cancelBackgroundCommand(), 5_000, "cancelBackgroundCommand")
				} catch (error) {
					Logger.error("Failed to cancel background command during task terminate", error)
				}
			}

			// PHASE 4: Run TaskCancel hook as fire-and-forget. It must not
			// block terminate because a slow or hanging hook would prevent
			// the user from closing a task.
			const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))
			if (hooksEnabled && shouldRunTaskCancelHook) {
				void (async () => {
					try {
						await executeHook({
							hookName: "TaskCancel",
							hookInput: {
								taskCancel: {
									taskMetadata: {
										taskId: this.taskId,
										ulid: this.ulid,
										completionStatus: this.taskState.abandoned ? "abandoned" : "cancelled",
									},
								},
							},
							isCancellable: false,
							say: this.say.bind(this),
							messageStateHandler: this.messageStateHandler,
							taskId: this.taskId,
							hooksEnabled,
							model: getHookModelContext(this.api, this.stateManager),
						})
					} catch (error) {
						Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
					}
				})()
			}

			// Save state before cleanup
			await this.flushTaskSnapshot()
			await this.messageStateHandler.updateTaskHistory()
			await this.postStateToWebview()

			// PHASE 6: Check for incomplete progress (focus chain)
			if (this.FocusChainManager) {
				const apiConfig = this.stateManager.getApiConfiguration()
				const currentMode = this.taskSm.mode
				const currentProfile = currentMode === "plan" ? apiConfig.planModeProfile : apiConfig.actModeProfile

				const currentProvider = resolveProviderFromProfile(currentProfile) || DEFAULT_API_PROVIDER
				const currentModelId = this.api.getModel().id
				this.FocusChainManager.checkIncompleteProgressOnCompletion(currentModelId, currentProvider)
			}

			// PHASE 7: Dispose all resources concurrently with per-operation
			// timeouts. A single stuck dispose (e.g. browser, diff revert)
			// must not prevent other resources from being released.
			const syncCleanups = [
				() => {
					this.terminalManager.disposeAll()
				},
				() => {
					this.urlContentFetcher.closeBrowser()
				},
				() => {
					this.clineIgnoreController.dispose()
				},
				() => {
					try {
						this.taskFileTracker.dispose()
					} catch {
						/* best-effort */
					}
				},
				() => {
					this.fileContextTracker.dispose()
				},
				() => {
					if (this._mcpNotificationCb) {
						this.mcpHub.removeNotificationCallback(this._mcpNotificationCb)
						this._mcpNotificationCb = undefined
					}
				},
				() => {
					if (this.FocusChainManager) this.FocusChainManager.dispose()
				},
			]
			const asyncCleanups: Array<Promise<void>> = [
				withTerminateTimeout(this.browserSession.dispose(), 5_000, "browserSession.dispose"),
				withTerminateTimeout(this.diffViewProvider.revertChanges(), 5_000, "diffViewProvider.revertChanges"),
				withTerminateTimeout(this.presentationScheduler.dispose(), 3_000, "presentationScheduler.dispose"),
			]

			// Run sync cleanups immediately (they are non-blocking)
			for (const fn of syncCleanups) {
				try {
					fn()
				} catch (error) {
					Logger.error("[Terminate] sync cleanup failed:", error)
				}
			}

			// Wait for async cleanups with timeouts
			await Promise.allSettled(asyncCleanups)
		} finally {
			// Final state update
			try {
				await this.flushTaskSnapshot()
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post final state after terminate", error)
			}
		}
	}

	// Tools
	async executeCommandTool(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<[boolean, ClineToolResponseContent]> {
		return this.commandExecutor.execute(command, timeoutSeconds, options)
	}

	/**
	 * Cancel a background command that is running in the background
	 * @returns true if a command was cancelled, false if no command was running
	 */
	public async cancelBackgroundCommand(): Promise<boolean> {
		return this.commandExecutor.cancelBackgroundCommand()
	}

	/**
	 * Cancel a currently running hook execution
	 * @returns true if a hook was cancelled, false if no hook was running
	 */
	public async cancelHookExecution(): Promise<boolean> {
		const activeHook = await this.getActiveHookExecution()
		if (!activeHook) {
			return false
		}

		const { hookName, toolName, messageTs, abortController } = activeHook

		try {
			// Abort the hook process
			abortController.abort()

			// Update hook message status to "cancelled"
			const clineMessages = this.messageStateHandler.clineMessages
			const hookMessageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
			if (hookMessageIndex !== -1) {
				const cancelledMetadata = {
					hookName,
					toolName,
					status: "cancelled",
					exitCode: 130, // Standard SIGTERM exit code
				}
				await this.messageStateHandler.updateClineMessage(hookMessageIndex, {
					text: JSON.stringify(cancelledMetadata),
				})
			}

			// Notify UI that hook was cancelled
			await this.say("hook_output_stream", "\nHook execution cancelled by user")

			// Return success - let caller (abortTask) handle next steps
			// DON'T call abortTask() here to avoid infinite recursion
			return true
		} catch (error) {
			Logger.error("Failed to cancel hook execution", error)
			return false
		}
	}

	private getCurrentProviderInfo(): ApiProviderInfo {
		const model = this.api.getModel()
		const mode = this.taskSm.mode
		// Read profile from per-task cache first to avoid cross-task interference
		const currentProfile = mode === "plan" ? this.taskSm.planModeProfile : this.taskSm.actModeProfile
		const providerId = resolveProviderFromProfile(currentProfile) || DEFAULT_API_PROVIDER
		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		return { model, providerId, customPrompt, mode }
	}

	/**
	 * Build a thinking summary from the current profile's provider-specific reasoning config.
	 * Returns undefined if no profile is configured or no reasoning data is available.
	 */
	private buildThinkingSummary(): Record<string, unknown> | undefined {
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.taskSm.mode
		const profileName = mode === "plan" ? apiConfig.planModeProfile : apiConfig.actModeProfile
		if (!profileName) {
			return undefined
		}

		const profile = findEnabledProfileByName(profileName)
		if (!profile) {
			return undefined
		}

		// Access provider-specific config via profile's provider key
		const providerKey = profile.provider
		const rawProfile = profile as unknown as Record<string, unknown>
		const provCfg = rawProfile[providerKey]
		if (!provCfg || typeof provCfg !== "object") {
			return undefined
		}

		const reasoning = (provCfg as Record<string, unknown>).reasoning as
			| { effort?: string; thinkingBudget?: number; enableThinking?: boolean }
			| undefined
		if (!reasoning) {
			return undefined
		}

		const model = this.api.getModel()
		const modelInfo = model.info as unknown as Record<string, unknown> | undefined
		const capabilities = (modelInfo?.capabilities ?? {}) as Record<string, unknown>

		return {
			enableThinking: reasoning.enableThinking,
			effort: reasoning.effort,
			thinkingBudget: reasoning.thinkingBudget,
			supportsReasoning: capabilities.supportsReasoning ?? false,
			supportsThinking: capabilities.supportsThinking ?? false,
		}
	}

	private async writePromptMetadataArtifacts(params: { systemPrompt: string; providerInfo: ApiProviderInfo }): Promise<void> {
		const enabledFlag = process.env.CLINE_WRITE_PROMPT_ARTIFACTS?.toLowerCase()
		const enabled = enabledFlag === "1" || enabledFlag === "true" || enabledFlag === "yes"
		if (!enabled) {
			return
		}

		try {
			const configuredDir = process.env.CLINE_PROMPT_ARTIFACT_DIR?.trim()
			const artifactDir = configuredDir
				? path.isAbsolute(configuredDir)
					? configuredDir
					: path.resolve(this.cwd, configuredDir)
				: path.resolve(this.cwd, ".cline-prompt-artifacts")

			await fs.mkdir(artifactDir, { recursive: true })

			const ts = new Date().toISOString()
			const safeTs = ts.replace(/[:.]/g, "-")
			const baseName = `task-${this.taskId}-req-${this.taskState.apiRequestCount}-${safeTs}`
			const manifestPath = path.join(artifactDir, `${baseName}.manifest.json`)
			const promptPath = path.join(artifactDir, `${baseName}.system_prompt.md`)

			const manifest = {
				taskId: this.taskId,
				ulid: this.ulid,
				apiRequestCount: this.taskState.apiRequestCount,
				ts,
				cwd: this.cwd,
				mode: params.providerInfo.mode,
				provider: params.providerInfo.providerId,
				model: params.providerInfo.model.id,
				apiRequestId: this.getApiRequestIdSafe(),
				systemPromptPath: promptPath,
			}

			await Promise.all([
				fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
				fs.writeFile(promptPath, params.systemPrompt, "utf8"),
			])
		} catch (error) {
			Logger.error("Failed to write prompt metadata artifacts:", error)
		}
	}

	private getApiRequestIdSafe(): string | undefined {
		const apiLike = this.api as Partial<{
			getLastRequestId: () => string | undefined
			lastGenerationId?: string
		}>
		return apiLike.getLastRequestId?.() ?? apiLike.lastGenerationId
	}

	/**
	 * Parse the previous request's total input pressure from UI request metadata.
	 *
	 * @param previousApiReqIndex Index of the previous api_req_started UI message.
	 * @returns Total request pressure tokens, or undefined when metadata is unavailable.
	 */
	private parsePreviousTokens(previousApiReqIndex: number): number | undefined {
		if (previousApiReqIndex < 0) {
			return undefined
		}

		const previousRequestText = this.messageStateHandler.clineMessages[previousApiReqIndex]?.text
		if (!previousRequestText) {
			return undefined
		}

		try {
			const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequestText)
			return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
		} catch {
			return undefined
		}
	}

	/**
	 * Cache the current assistant tool-use turn and remove it from history before summarizing older context.
	 *
	 * @param userContent Pending tool result content for the next request.
	 * @returns True when a current turn was cached and removed from API history.
	 */
	private async deferCurrentTurn(userContent: ClineContent[]): Promise<boolean> {
		const apiHistory = this.messageStateHandler.apiConversationHistory
		const assistantMessage = apiHistory[apiHistory.length - 1]
		if (!assistantMessage || assistantMessage.role !== "assistant") {
			return false
		}

		this.taskState.deferredCurrentTurn = {
			assistantMessage: cloneDeep(assistantMessage),
			userContent: cloneDeep(userContent),
		}

		await this.messageStateHandler.overwriteApiConversationHistory(apiHistory.slice(0, -1))
		return true
	}

	/**
	 * Restore a deferred current turn after summarize_task has produced compacted context.
	 *
	 * @param summaryContent The summarize_task tool result content containing compacted context.
	 * @returns The deferred tool result content, or the original content if no deferred turn exists.
	 */
	private async restoreDeferredTurn(summaryContent: ClineContent[]): Promise<ClineContent[]> {
		const deferredTurn = this.taskState.deferredCurrentTurn
		if (!deferredTurn) {
			return summaryContent
		}

		this.taskState.deferredCurrentTurn = undefined
		const summaryText = summaryContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n")
		if (summaryText.trim().length > 0) {
			await this.messageStateHandler.addToApiConversationHistory({
				role: "user",
				content: [{ type: "text", text: summaryText }],
				ts: Date.now(),
			})
		}

		await this.messageStateHandler.addToApiConversationHistory(deferredTurn.assistantMessage)
		return deferredTurn.userContent
	}

	private async handleContextWindowExceededError(): Promise<void> {
		const apiConversationHistory = this.messageStateHandler.apiConversationHistory

		// Run PreCompact hook before truncation
		const hooksEnabled = getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))
		if (hooksEnabled) {
			try {
				// Calculate what the new deleted range will be
				const deletedRange = this.calculatePreCompactDeletedRange(apiConversationHistory)

				// Execute hook - throws HookCancellationError if cancelled
				await executePreCompactHookWithCleanup({
					taskId: this.taskId,
					ulid: this.ulid,
					modelContext: getHookModelContext(this.api, this.stateManager),
					apiConversationHistory,
					conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					contextManager: this.contextManager,
					clineMessages: this.messageStateHandler.clineMessages,
					messageStateHandler: this.messageStateHandler,
					compactionStrategy: "standard-truncation-lastquarter",
					deletedRange,
					say: this.say.bind(this),
					setActiveHookExecution: async (hookExecution: HookExecution | undefined) => {
						if (hookExecution) {
							await this.setActiveHookExecution(hookExecution)
						}
					},
					clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
					postStateToWebview: this.postStateToWebview.bind(this),
					taskState: this.taskState,
					cancelTask: this.cancelTask.bind(this),
					hooksEnabled,
				})
			} catch (error) {
				// If hook was cancelled, re-throw to stop compaction
				if (error instanceof HookCancellationError) {
					throw error
				}

				// Graceful degradation: Log error but continue with truncation
				Logger.error("[PreCompact] Hook execution failed:", error)
			}
		}

		// Proceed with standard truncation
		const newDeletedRange = this.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation
		)

		this.taskState.conversationHistoryDeletedRange = newDeletedRange

		await this.messageStateHandler.updateTaskHistory()
		await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(this.taskId),
			apiConversationHistory,
		)

		this.taskState.didAutomaticallyRetryFailedApiRequest = true
	}

	async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		const apiReqStart = performance.now()
		Logger.debug(`[Task ${this.taskId}] attemptApiRequest: start (req #${this.taskState.apiRequestCount})`)
		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => this.mcpHub.isConnecting !== true, {
			timeout: 10_000,
		}).catch(() => {
			Logger.error("MCP servers failed to connect in time")
		})
		Logger.debug(`[Task ${this.taskId}] attemptApiRequest: MCP connected +${Math.round(performance.now() - apiReqStart)}ms`)

		const providerInfo = this.getCurrentProviderInfo()
		const host = await HostProvider.env.getHostVersion({})
		const ide = host?.platform || "Unknown"
		const isCliEnvironment = host.clineType === ClineClient.Cli
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const disableBrowserTool = browserSettings.disableToolUse ?? false
		// cline browser tool uses image recognition for navigation (requires model image support).
		const modelSupportsBrowserUse = providerInfo.model.info.capabilities?.supportsImages ?? false

		const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool // only enable browser use if the model supports it and the user hasn't disabled it
		const preferredLanguageRaw = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
		const preferredLanguageInstructions =
			preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
				? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
				: ""

		const { globalToggles, localToggles } = await refreshClineRulesToggles(this.controller, this.cwd)
		const { windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
			this.controller,
			this.cwd,
		)

		const evaluationContext = await RuleContextBuilder.buildEvaluationContext({
			cwd: this.cwd,
			messageStateHandler: this.messageStateHandler,
			workspaceManager: this.workspaceManager,
		})

		const globalClineRulesFilePath = await ensureRulesDirectoryExists()
		const globalRules = await getGlobalClineRules(globalClineRulesFilePath, globalToggles, { evaluationContext })
		let globalClineRulesFileInstructions = globalRules.instructions

		// Inject Lazy Teammate Mode rules if enabled
		const lazyTeammateModeEnabled = this.stateManager.getGlobalSettingsKey("lazyTeammateModeEnabled")
		if (lazyTeammateModeEnabled) {
			const { LAZY_TEAMMATE_RULES } = await import("@/core/context/instructions/lazy-teammate-rules")
			globalClineRulesFileInstructions = globalClineRulesFileInstructions
				? `${globalClineRulesFileInstructions}\n\n${LAZY_TEAMMATE_RULES}`
				: LAZY_TEAMMATE_RULES
		}

		const primaryRoot = this.workspaceManager?.getPrimaryRoot()
		const workspaceName = this.getPrimaryWorkspaceName(primaryRoot)
		const localRules = await getLocalClineRules(this.cwd, localToggles, workspaceName, { evaluationContext })
		const localClineRulesFileInstructions = localRules.instructions
		const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
			this.cwd,
			cursorLocalToggles,
		)
		const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(this.cwd, windsurfLocalToggles)

		const localAgentsRulesFileInstructions = await getLocalAgentsRules(this.cwd, agentsLocalToggles)

		const clineIgnoreContent = this.clineIgnoreController.clineIgnoreContent
		let clineIgnoreInstructions: string | undefined
		if (clineIgnoreContent) {
			clineIgnoreInstructions = formatResponse.clineIgnoreInstructions(clineIgnoreContent)
		}

		// Prepare multi-root workspace information if enabled
		let workspaceRoots: Array<{ path: string; name: string; vcs?: string }> | undefined
		const multiRootEnabled = isMultiRootEnabled(this.stateManager)
		if (multiRootEnabled && this.workspaceManager) {
			workspaceRoots = this.workspaceManager.getRoots().map((root) => ({
				path: root.path,
				name: root.name || path.basename(root.path), // Fallback to basename if name is undefined
				vcs: root.vcs as string | undefined, // Cast VcsType to string
			}))
		}

		// Discover and filter available skills
		const remoteSkillEntries = this.stateManager.getRemoteConfigSettings().remoteGlobalSkills || []
		const availableSkills = await discoverAvailableSkills(this.cwd, {
			remoteSkillEntries,
			globalSkillsToggles: this.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {},
			localSkillsToggles: this.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {},
			remoteSkillsToggles: this.stateManager.getGlobalStateKey("remoteSkillsToggles") ?? {},
		})

		// Snapshot editor tabs so prompt tools can decide whether to include
		// filetype-specific instructions (e.g. notebooks) without adding bespoke flags.
		const openTabPaths = (await HostProvider.window.getOpenTabs({})).paths || []
		const visibleTabPaths = (await HostProvider.window.getVisibleTabs({})).paths || []
		const cap = 50
		const editorTabs = {
			open: openTabPaths.slice(0, cap),
			visible: visibleTabPaths.slice(0, cap),
		}

		// Disable spawn_task for child tasks to prevent recursive spawn explosion.
		// A spawned task inherits the parent's provider and should focus on its
		// assigned sub-problem without spawning further tasks.
		const disableTools: ClineDefaultTool[] = []
		const { OrchestratorController } = await import("@/core/orchestrator/OrchestratorController")
		const parentTaskId = OrchestratorController.getInstance().getParentTaskId(this.taskId)
		if (parentTaskId) {
			disableTools.push(ClineDefaultTool.SPAWN_TASK)
		}

		const promptContext: SystemPromptContext = {
			taskId: this.taskId,
			cwd: this.cwd,
			ide,
			providerInfo,
			editorTabs,
			supportsBrowserUse,
			mcpHub: this.mcpHub,
			skills: availableSkills,
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			globalClineRulesFileInstructions,
			localClineRulesFileInstructions,
			localCursorRulesFileInstructions,
			localCursorRulesDirInstructions,
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
			clineIgnoreInstructions,
			preferredLanguageInstructions,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			subagentsEnabled: this.stateManager.getGlobalSettingsKey("subagentsEnabled"),
			clineWebToolsEnabled:
				this.stateManager.getGlobalSettingsKey("clineWebToolsEnabled") && featureFlagsService.getWebtoolsEnabled(),
			isMultiRootEnabled: multiRootEnabled,
			workspaceRoots,
			isSubagentRun: false,
			isCliEnvironment,
			enableNativeToolCalls:
				(providerInfo.model.info as any).apiFormat === ApiFormat.OPENAI_RESPONSES ||
				this.stateManager.getGlobalStateKey("nativeToolCallEnabled"),
			enableParallelToolCalling: this.isParallelToolCallingEnabled(),
			terminalExecutionMode: this.terminalExecutionMode,
			disableTools,
		}

		// Notify user if any conditional rules were applied for this request
		const activatedConditionalRules = [...globalRules.activatedConditionalRules, ...localRules.activatedConditionalRules]
		if (activatedConditionalRules.length > 0) {
			await this.say("conditional_rules_applied", JSON.stringify({ rules: activatedConditionalRules }))
		}

		Logger.debug(
			`[Task ${this.taskId}] attemptApiRequest: before systemPrompt +${Math.round(performance.now() - apiReqStart)}ms`,
		)
		const { systemPrompt, tools } = await getSystemPrompt(promptContext)
		Logger.debug(
			`[Task ${this.taskId}] attemptApiRequest: after systemPrompt +${Math.round(performance.now() - apiReqStart)}ms`,
		)
		this.useNativeToolCalls = !!tools?.length
		await this.writePromptMetadataArtifacts({ systemPrompt, providerInfo })

		const contextManagementMetadata = await this.contextManager.getNewContextMessagesAndMetadata(
			this.messageStateHandler.apiConversationHistory,
			this.messageStateHandler.clineMessages,
			this.api,
			this.taskState.conversationHistoryDeletedRange,
			previousApiReqIndex,
			await ensureTaskDirectoryExists(this.taskId),
			this.stateManager.getGlobalSettingsKey("useAutoCondense") && isNextGenModelFamily(this.api.getModel().id),
		)

		if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
			this.taskState.conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
			await this.messageStateHandler.updateTaskHistory()
			// saves task history item which we use to keep track of conversation history deleted range
		}

		// Response API requires native tool calls to be enabled
		Logger.debug(
			`[Task ${this.taskId}] attemptApiRequest: after contextMgmt +${Math.round(performance.now() - apiReqStart)}ms`,
		)
		// Debug: record full API request context when DLINE_LOG_API_CONTEXT=1 or IS_DEV=true
		await appendDebugRequestContext(this.taskId, {
			ts: Date.now(),
			requestIndex: this.taskState.apiRequestCount,
			systemPrompt,
			messages: contextManagementMetadata.truncatedConversationHistory,
			tools,
		})

		// Log the API request context: profile, provider, model, and thinking status
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.taskSm.mode
		const profileName = mode === "plan" ? apiConfig.planModeProfile : apiConfig.actModeProfile
		const thinkingSummary = this.buildThinkingSummary()
		Logger.info(`[Task] sending API request`, {
			taskId: this.taskId,
			apiRequestCount: this.taskState.apiRequestCount,
			mode,
			profileName: profileName ?? "(none)",
			provider: providerInfo.providerId,
			modelId: providerInfo.model.id,
			modelName: providerInfo.model.info?.name ?? providerInfo.model.id,
			thinking: thinkingSummary ?? null,
		})

		const stream = this.api.createMessage(systemPrompt, contextManagementMetadata.truncatedConversationHistory, tools)

		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			this.taskState.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.taskState.isWaitingForFirstChunk = false
			Logger.debug(`[Task ${this.taskId}] attemptApiRequest: TTFB +${Math.round(performance.now() - apiReqStart)}ms`)
		} catch (error) {
			const isContextWindowExceededError = checkContextWindowExceededError(error)
			const { model, providerId } = this.getCurrentProviderInfo()
			// Use provider-specific parseError if available, otherwise fall back to generic classification.
			// Telemetry: toClineError logs internally; parseError must log manually when used.
			const clineError =
				this.api.parseError?.(error, model.id) ?? ErrorService.get().toClineError(error, model.id, providerId)
			if (this.api.parseError) {
				ErrorService.get().logException(clineError, { modelId: model.id, providerId })
			}

			// Capture provider failure telemetry using clineError
			ErrorService.get().logMessage(clineError.message)

			if (isContextWindowExceededError && !this.taskState.didAutomaticallyRetryFailedApiRequest) {
				await this.handleContextWindowExceededError()
			} else {
				// request failed after retrying automatically once, ask user if they want to retry again
				// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.

				if (isContextWindowExceededError) {
					const truncatedConversationHistory = this.contextManager.getTruncatedMessages(
						this.messageStateHandler.apiConversationHistory,
						this.taskState.conversationHistoryDeletedRange,
					)

					// If the conversation has more than 3 messages, we can truncate again. If not, then the conversation is bricked.
					// ToDo: Allow the user to change their input if this is the case.
					if (truncatedConversationHistory.length > 3) {
						clineError.message = "Context window exceeded. Click retry to truncate the conversation and try again."
						this.taskState.didAutomaticallyRetryFailedApiRequest = false
					}
				}

				const streamingFailedMessage = clineError.serialize()

				// Update the 'api_req_started' message to reflect final failure before asking user to manually retry
				const lastApiReqStartedIndex = findLastIndex(
					this.messageStateHandler.clineMessages,
					(m) => m.say === "api_req_started",
				)
				if (lastApiReqStartedIndex !== -1) {
					const clineMessages = this.messageStateHandler.clineMessages
					const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[lastApiReqStartedIndex].text || "{}")
					delete currentApiReqInfo.retryStatus

					await this.messageStateHandler.updateClineMessage(lastApiReqStartedIndex, {
						text: JSON.stringify({
							...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
							// cancelReason: "retries_exhausted", // Indicate that automatic retries failed
							streamingFailedMessage,
						} satisfies ClineApiReqInfo),
					})
					// this.ask will trigger postStateToWebview, so this change should be picked up.
				}

				const isAuthError = clineError.isErrorType(ClineErrorType.Auth)
				const isSpendLimitError = clineError.isErrorType(ClineErrorType.SpendLimit)
				const quotaExceeded = clineError.isErrorType(ClineErrorType.QuotaExceeded)

				// Check if this is an insufficient credits / balance error - don't auto-retry these
				const isInsufficientCredits = clineError.isErrorType(ClineErrorType.Balance)

				let response: ClineAskResponse
				// Skip auto-retry for Cline provider insufficient credits, auth errors, or spend limit errors
				const shouldRetry =
					!isInsufficientCredits &&
					!isAuthError &&
					!isSpendLimitError &&
					!quotaExceeded &&
					this.taskState.autoRetryAttempts < 3
				if (shouldRetry) {
					// Auto-retry enabled with max 3 attempts: automatically approve the retry
					this.taskState.autoRetryAttempts++

					// Calculate delay: 2s, 4s, 8s
					const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)

					await updateApiReqMsg({
						messageStateHandler: this.messageStateHandler,
						lastApiReqIndex: lastApiReqStartedIndex,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: undefined,
						api: this.api,
						cancelReason: "streaming_failed",
						streamingFailedMessage,
					})
					await this.messageStateHandler.updateTaskHistory()
					await this.postStateToWebview()

					response = "yesButtonClicked"
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: this.taskState.autoRetryAttempts,
							maxAttempts: 3,
							delaySeconds: delay / 1000,
							errorMessage: streamingFailedMessage,
						}),
					)

					// Clear streamingFailedMessage now that error_retry contains it
					// This prevents showing the error in both ErrorRow and error_retry
					const autoRetryApiReqIndex = findLastIndex(
						this.messageStateHandler.clineMessages,
						(m) => m.say === "api_req_started",
					)
					if (autoRetryApiReqIndex !== -1) {
						const clineMessages = this.messageStateHandler.clineMessages
						const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[autoRetryApiReqIndex].text || "{}")
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateClineMessage(autoRetryApiReqIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})
					}

					await setTimeoutPromise(delay)
				} else {
					// Show error_retry with failed flag to indicate all retries exhausted (but not for insufficient credits or spend limit)
					const showRetry = !isInsufficientCredits && !isAuthError && !isSpendLimitError && !quotaExceeded
					if (showRetry) {
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: 3,
								maxAttempts: 3,
								delaySeconds: 0,
								failed: true, // Special flag to indicate retries exhausted
								errorMessage: streamingFailedMessage,
							}),
						)
					}
					const askResult = await this.ask("api_req_failed", streamingFailedMessage)
					response = askResult.response
					if (response === "yesButtonClicked") {
						this.taskState.autoRetryAttempts = 0
					}
				}

				if (response !== "yesButtonClicked") {
					// this will never happen since if noButtonClicked, we will clear current task, aborting this instance
					throw new Error("API request failed")
				}

				// Clear streamingFailedMessage when user manually retries
				const manualRetryApiReqIndex = findLastIndex(
					this.messageStateHandler.clineMessages,
					(m) => m.say === "api_req_started",
				)
				if (manualRetryApiReqIndex !== -1) {
					const clineMessages = this.messageStateHandler.clineMessages
					const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[manualRetryApiReqIndex].text || "{}")
					delete currentApiReqInfo.streamingFailedMessage
					await this.messageStateHandler.updateClineMessage(manualRetryApiReqIndex, {
						text: JSON.stringify(currentApiReqInfo),
					})
				}

				await this.say("api_req_retried")

				// Reset the automatic retry flag so the request can proceed
				this.taskState.didAutomaticallyRetryFailedApiRequest = false
			}
			// delegate generator output from the recursive call
			yield* this.attemptApiRequest(previousApiReqIndex)
			return
		}

		// no error, so we can continue to yield all remaining chunks
		// (needs to be placed outside of try/catch since it we want caller to handle errors not with api_req_failed as that is reserved for first chunk failures only)
		// this delegates to another generator or iterable object. In this case, it's saying "yield all remaining values from this iterator". This effectively passes along all subsequent chunks from the original stream.
		yield* iterator
	}

	// Block identity is now assigned at parse time via parseAssistantMessageV2's
	// source-offset ts registry. No post-hoc matching needed.

	/**
	 * Compute a stable render signature for same-ts content dedup.
	 * Used only to skip re-sending identical partial events — never for block identity.
	 */
	private computeBlockRenderSignature(block: AssistantMessageContent): string {
		if (block.type === "text") {
			return `text:${(block as TextStreamContent).content}`
		}
		if (block.type === "tool_use") {
			const tool = block as ToolUse
			return JSON.stringify({ name: tool.name, params: tool.params })
		}
		return ""
	}

	/**
	 * Re-render partial blocks whose content has changed since last presentation,
	 * and replay complete execution for tool blocks that transitioned from partial
	 * to non-partial after the presentation index advanced past them.
	 */
	private async reRenderUpdatedPartialBlocks(blocks: AssistantMessageContent[]): Promise<void> {
		for (let i = 0; i < this.taskState.currentStreamingContentIndex; i++) {
			const block = blocks[i]
			if (block === undefined) continue
			if (block.type === "reasoning") continue

			const blockTs = (block as TextStreamContent | ToolUse).ts
			if (blockTs === undefined) continue

			// ── Non-partial: tool lifecycle complete execution ──
			if (!(block as TextStreamContent | ToolUse).partial) {
				if (block.type === "tool_use") {
					const lifecycle = this.taskState.partialToolLifecycleByTs.get(blockTs)
					const action = getDeferredToolAction(
						lifecycle,
						isTurnEndingToolUse(block),
						this.taskState.didCompleteReadingStream,
					)

					if (action === "defer" || action === "skip") {
						continue // defer keeps partial-shown; skip for done/absent
					}

					// action === "execute"
					advanceLifecycle(this.taskState.partialToolLifecycleByTs, blockTs, "start-execute")
					try {
						await this.toolExecutor.executeTool(block as ToolUse)
						advanceLifecycle(this.taskState.partialToolLifecycleByTs, blockTs, "execution-success")
					} catch (error) {
						Logger.error(`[Task ${this.taskId}] Failed to complete deferred partial tool ts=${blockTs}`, error)
						advanceLifecycle(this.taskState.partialToolLifecycleByTs, blockTs, "execution-failed")
						throw error
					}
				}
				continue
			}

			// ── Partial: existing content-change rerender ──
			const newSig = this.computeBlockRenderSignature(block as TextStreamContent | ToolUse)
			const oldSig = this.taskState.lastRenderedPartialByTs.get(blockTs)
			if (newSig === oldSig) continue

			if (block.type === "text") {
				const textBlock = block as TextStreamContent
				await this.say("text", textBlock.content, undefined, undefined, true, blockTs)
				this.taskState.lastRenderedPartialByTs.set(blockTs, newSig)
			} else if (block.type === "tool_use") {
				await this.toolExecutor.reRenderPartialBlock(block as ToolUse, blockTs)
				this.taskState.lastRenderedPartialByTs.set(blockTs, newSig)
			}
		}
	}

	async presentAssistantMessage() {
		if (this.taskState.abort) {
			throw new Error("Dline instance aborted")
		}

		// If we're locked, mark pending and return
		if (this.taskState.presentAssistantMessageLocked) {
			this.taskState.presentAssistantMessageHasPendingUpdates = true
			return
		}

		this.taskState.presentAssistantMessageLocked = true
		this.taskState.presentAssistantMessageHasPendingUpdates = false

		// Frame-local flags: state mutations happen inside try, recursive calls
		// happen after finally releases the lock.
		let shouldRecurse = false
		let didAdvance = false

		try {
			// Re-render blocks that have changed since last presentation
			await this.reRenderUpdatedPartialBlocks(this.taskState.assistantMessageContent)

			if (this.taskState.currentStreamingContentIndex >= this.taskState.assistantMessageContent.length) {
				if (this.taskState.didCompleteReadingStream) {
					this.taskState.userMessageContentReady = true
				}
				return
			}

			const block = cloneDeep(this.taskState.assistantMessageContent[this.taskState.currentStreamingContentIndex])
			switch (block.type) {
				case "text": {
					if (
						this.taskController.hasAnyRejection() ||
						(!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool)
					) {
						break
					}
					const textBlock = block as TextStreamContent
					let content = textBlock.content
					if (content) {
						content = content.replace(/<thinking>\s?/g, "")
						content = content.replace(/\s?<\/thinking>/g, "")
						content = content.replace(/<think>\s?/g, "")
						content = content.replace(/\s?<\/think>/g, "")
						content = content.replace(/<function_calls>\s?/g, "")
						content = content.replace(/\s?<\/function_calls>/g, "")
						const lastOpenBracketIndex = content.lastIndexOf("<")
						if (lastOpenBracketIndex !== -1) {
							const possibleTag = content.slice(lastOpenBracketIndex)
							const hasCloseBracket = possibleTag.includes(">")
							if (!hasCloseBracket) {
								let tagContent: string
								if (possibleTag.startsWith("</")) {
									tagContent = possibleTag.slice(2).trim()
								} else {
									tagContent = possibleTag.slice(1).trim()
								}
								const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
								const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
								if (isOpeningOrClosing || isLikelyTagName) {
									content = content.slice(0, lastOpenBracketIndex).trim()
								}
							}
						}
					}
					if (!block.partial) {
						const match = content?.trimEnd().match(/```[a-zA-Z0-9_-]+$/)
						if (match) {
							content = content.trimEnd().slice(0, -match[0].length)
						}
					}
					// Use block.ts assigned at parse time for identity.
					// Use block.ts assigned at parse time for identity.
					const existingTs = (block as TextStreamContent).ts
					const returnedTs = await this.say("text", content, undefined, undefined, block.partial, existingTs)
					if (block.partial) {
						if (returnedTs !== undefined) {
							this.taskState.lastRenderedPartialByTs.set(returnedTs, this.computeBlockRenderSignature(block))
						}
					}
					break
				}
				case "tool_use":
					// Allow partial turn-ending tools (plan_mode_respond, attempt_completion, etc.)
					// to stream content via handlePartialBlock for UI feedback.
					// Only skip complete (non-partial) turn-ending tools when the stream hasn't finished.
					if (!block.partial && isTurnEndingToolUse(block) && !this.taskState.didCompleteReadingStream) {
						return
					}
					if (this.initialCheckpointCommitPromise) {
						if (!READ_ONLY_TOOLS.includes(block.name as any)) {
							await this.initialCheckpointCommitPromise
							this.initialCheckpointCommitPromise = undefined
						}
					}

					// Build turn on first complete tool_use block if not already built
					if (!block.partial && this.taskState.didCompleteReadingStream) {
						const allBlocks = this.taskState.assistantMessageContent
						this.taskController.buildTurn(allBlocks, (toolName, _callId) => {
							return this.toolExecutor.isAutoApproved(toolName as any)
						})
					}

					// Check if this block should be skipped due to prior rejection
					if (this.taskController.shouldSkip((block as ToolUse).call_id || "")) {
						break
					}

					await this.toolExecutor.executeTool(block)
					// Register lifecycle so reRenderUpdatedPartialBlocks and processNativeToolCalls
					// can skip tools that have already completed execution. Partial tools are
					// marked "partial-shown" so they get replayed via handleCompleteBlock when the
					// stream later finishes them; non-partial (directly complete) tools are marked
					// "complete-done" immediately to prevent re-execution when the index is
					// rewound by subsequent tool_calls chunks.
					if (block.ts !== undefined) {
						if (block.partial) {
							this.taskState.partialToolLifecycleByTs.set(block.ts, "partial-shown")
						} else {
							this.taskState.partialToolLifecycleByTs.set(block.ts, "complete-done")
						}
					}

					if (block.call_id) {
						Session.get().updateToolCall(block.call_id, block.name)
					}
					break
			}

			// Determine whether to advance to next block (all state mutations
			// happen here inside the try block).
			const _isToolPartial = block.type === "tool_use" && block.partial
			if (
				!block.partial ||
				this.taskController.hasAnyRejection() ||
				(!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool)
			) {
				if (this.taskState.currentStreamingContentIndex === this.taskState.assistantMessageContent.length - 1) {
					this.taskState.userMessageContentReady = true
				}
				this.taskState.currentStreamingContentIndex++
				didAdvance = true
				if (this.taskState.currentStreamingContentIndex < this.taskState.assistantMessageContent.length) {
					shouldRecurse = true
				}
			}
		} finally {
			// Always release the lock, even if reRender, say(), or executeTool throws.
			this.taskState.presentAssistantMessageLocked = false
		}

		// Safe to recurse now that the lock is released.
		if (shouldRecurse) {
			await this.presentAssistantMessage()
		} else if (!didAdvance && this.taskState.presentAssistantMessageHasPendingUpdates) {
			await this.presentAssistantMessage()
		}
	}

	async recursivelyMakeClineRequests(userContent: ClineContent[], includeFileDetails = false): Promise<boolean> {
		// Check abort flag at the very start to prevent any execution after cancellation
		if (this.taskState.abort) {
			throw new Error("Task instance aborted")
		}

		// Ensure remote workspace detection completes before streaming begins so
		// the presentation scheduler uses the correct cadence from the first flush.
		await this.remoteWorkspaceDetectionPromise

		// Increment API request counter for focus chain list management
		this.taskState.apiRequestCount++
		this.taskState.apiRequestsSinceLastTodoUpdate++

		// Used to know what models were used in the task if user wants to export metadata for error reporting purposes
		const { model, providerId, customPrompt, mode } = this.getCurrentProviderInfo()
		if (providerId && model.id) {
			try {
				await this.modelContextTracker.recordModelUsage(providerId, model.id, mode)
			} catch {}
		}

		const modelInfo: ClineMessageModelInfo = {
			modelId: model.id,
			providerId: providerId,
			mode: mode,
		}

		if (this.taskState.consecutiveMistakeCount >= this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")) {
			// In yolo mode, don't wait for user input - fail the task
			if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
				const errorMessage =
					`[YOLO MODE] Task failed: Too many consecutive mistakes (${this.taskState.consecutiveMistakeCount}). ` +
					`The model may not be capable enough for this task. Consider using a more capable model.`
				await this.say("error", errorMessage)
				// End the task loop with failure
				return true // didEndLoop = true, signals task completion/failure
			}

			const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			if (autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Error",
					message: "Cline is having trouble. Would you like to continue the task?",
				})
			}
			const { response, text, images, files } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in Dline's thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Dline uses complex prompts and iterative task execution. Verify your chosen model supports advanced agentic coding and complex prompt following.",
			)
			if (response === "messageResponse") {
				// Display the user's message in the chat UI
				await this.say("user_feedback", text, images, files)

				// This userContent is for the *next* API call.
				const feedbackUserContent: ClineUserContent[] = []
				feedbackUserContent.push({
					type: "text",
					text: formatResponse.tooManyMistakes(text),
				})
				if (images && images.length > 0) {
					feedbackUserContent.push(...formatResponse.imageBlocks(images))
				}

				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				if (fileContentString) {
					feedbackUserContent.push({
						type: "text",
						text: fileContentString,
					})
				}

				userContent = feedbackUserContent
			}
			this.taskState.consecutiveMistakeCount = 0
			this.taskState.autoRetryAttempts = 0 // need to reset this if the user chooses to manually retry after the mistake limit is reached
			// Reset loop detection state so it can re-arm if the model continues looping
			this.taskState.consecutiveIdenticalToolCount = 0
			this.taskState.lastToolName = ""
			this.taskState.lastToolParams = ""
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.messageStateHandler.clineMessages, (m) => m.say === "api_req_started")

		// Save checkpoint if this is the first API request
		const isFirstRequest = this.messageStateHandler.clineMessages.filter((m) => m.say === "api_req_started").length === 0

		// Initialize checkpointManager first if enabled and it's the first request
		if (
			isFirstRequest &&
			this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting") &&
			this.checkpointManager && // TODO REVIEW: may be able to implement a replacement for the 15s timer
			!this.taskState.checkpointManagerErrorMessage
		) {
			try {
				await ensureCheckpointInitialized({ checkpointManager: this.checkpointManager })
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				Logger.error("Failed to initialize checkpoint manager:", errorMessage)
				this.taskState.checkpointManagerErrorMessage = errorMessage // will be displayed right away since we saveClineMessages next which posts state to webview
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Checkpoint initialization timed out: ${errorMessage}`,
				})
			}
		}

		// Now, if it's the first request AND checkpoints are enabled AND tracker was successfully initialized,
		// then say "checkpoint_created" and perform the commit.
		if (
			isFirstRequest &&
			this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting") &&
			this.checkpointManager &&
			!this.taskState.checkpointManagerErrorMessage
		) {
			await this.say("checkpoint_created") // Now this is conditional
			const lastCheckpointMessageIndex = findLastIndex(
				this.messageStateHandler.clineMessages,
				(m) => m.say === "checkpoint_created",
			)
			if (lastCheckpointMessageIndex !== -1) {
				const commitPromise = this.checkpointManager?.commit()
				this.initialCheckpointCommitPromise = commitPromise
				commitPromise
					?.then(async (commitHash) => {
						if (commitHash) {
							await this.messageStateHandler.updateClineMessage(lastCheckpointMessageIndex, {
								lastCheckpointHash: commitHash,
							})
							// updateTaskHistory will be called later after API response,
							// so no need to call it here unless this is the only modification to this message.
							// For now, assuming it's handled later.
						}
					})
					.catch((error) => {
						Logger.error(`[TaskCheckpointManager] Failed to create checkpoint commit for task ${this.taskId}:`, error)
					})
			}
		} else if (
			isFirstRequest &&
			this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting") &&
			!this.checkpointManager &&
			this.taskState.checkpointManagerErrorMessage
		) {
			// Checkpoints are enabled, but tracker failed to initialize.
			// checkpointManagerErrorMessage is already set and will be part of the state.
			// No explicit UI message here, error message will be in ExtensionState.
		}

		// Determine if we should compact context window
		// Note: We delay context loading until we know if we're compacting (performance optimization)
		const useCompactPrompt = customPrompt === "compact" && isLocalModel(this.getCurrentProviderInfo())
		let shouldCompact = false
		const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")

		if (useAutoCondense && isNextGenModelFamily(this.api.getModel().id)) {
			// When we initially trigger context cleanup, we increase the context window size, so we need state `currentlySummarizing`
			// to track if we've already started the context summarization flow. After summarizing, we increment
			// conversationHistoryDeletedRange to mask out the summarization-trigger user & assistant response messages
			if (this.taskState.currentlySummarizing) {
				this.taskState.currentlySummarizing = false

				if (this.taskState.conversationHistoryDeletedRange) {
					const [start, end] = this.taskState.conversationHistoryDeletedRange
					const apiHistory = this.messageStateHandler.apiConversationHistory

					// we want to increment the deleted range to remove the pre-summarization tool call output, with additional safety check
					const safeEnd = Math.min(end + 2, apiHistory.length - 1)
					if (end + 2 <= safeEnd) {
						this.taskState.conversationHistoryDeletedRange = [start, end + 2]
						await this.messageStateHandler.updateTaskHistory()
					}
				}
			} else {
				shouldCompact = this.contextManager.shouldCompactContextWindow(
					this.messageStateHandler.clineMessages,
					this.api,
					previousApiReqIndex,
				)

				const previousTokens = this.parsePreviousTokens(previousApiReqIndex)
				if (!shouldCompact && previousTokens !== undefined) {
					const { contextWindow } = getContextWindowInfo(this.api)
					const shouldDeferTurn = shouldDeferCurrentTurn({
						contextWindow,
						previousTokens,
						userContent,
					})
					if (shouldDeferTurn) {
						shouldCompact = await this.deferCurrentTurn(userContent)
					}
				}

				// Edge case: summarize_task tool call completes but user cancels next request before it finishes.
				// This results in currentlySummarizing being false, and we fail to update the context window token estimate.
				// Check active message count to avoid summarizing a summary (bad UX but doesn't break logic).
				if (shouldCompact && this.taskState.conversationHistoryDeletedRange) {
					const apiHistory = this.messageStateHandler.apiConversationHistory
					const activeMessageCount = apiHistory.length - this.taskState.conversationHistoryDeletedRange[1] - 1

					// IMPORTANT: We haven't appended the next user message yet, so the last message is an assistant message.
					// That's why we compare to even numbers (0, 2) rather than odd (1, 3).
					if (activeMessageCount <= 2) {
						shouldCompact = false
					}
				}

				// Determine whether we can save enough tokens from context rewriting to skip auto-compact
				if (shouldCompact && !this.taskState.deferredCurrentTurn) {
					shouldCompact = await this.contextManager.attemptFileReadOptimization(
						this.messageStateHandler.apiConversationHistory,
						this.taskState.conversationHistoryDeletedRange,
						this.messageStateHandler.clineMessages,
						previousApiReqIndex,
						await ensureTaskDirectoryExists(this.taskId),
					)
				}
			}
		}

		const deferredUserContent = await this.restoreDeferredTurn(userContent)
		if (deferredUserContent !== userContent) {
			return this.recursivelyMakeClineRequests(deferredUserContent, includeFileDetails)
		}

		// NOW load context based on compaction decision
		// This optimization avoids expensive context loading when using summarize_task
		let parsedUserContent: ClineContent[]
		let environmentDetails: string
		let clinerulesError: boolean

		if (shouldCompact) {
			// When compacting, skip full context loading (use summarize_task instead)
			parsedUserContent = this.taskState.deferredCurrentTurn ? [] : userContent
			environmentDetails = ""
			clinerulesError = false
			this.taskState.lastAutoCompactTriggerIndex = previousApiReqIndex
		} else {
			// When NOT compacting, load full context with mentions parsing and slash commands
			;[parsedUserContent, environmentDetails, clinerulesError] = await this.loadContext(
				userContent,
				includeFileDetails,
				useCompactPrompt,
			)
		}

		// error handling if the user uses the /newrule command & their .clinerules is a file, for file read operations didnt work properly
		if (clinerulesError === true) {
			await this.say(
				"error",
				"Issue with processing the /newrule command. Double check that, if '.clinerules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
			)
		}

		// Replace userContent with parsed content that includes file details and command instructions.
		userContent = parsedUserContent

		// add environment details as its own text block, separate from tool results
		// do not add environment details to the message which we are compacting the context window
		if (environmentDetails) {
			userContent.push({ type: "text", text: environmentDetails })
		}

		if (shouldCompact) {
			userContent.push({
				type: "text",
				text: summarizeTask(
					this.stateManager.getGlobalSettingsKey("focusChainSettings"),
					this.cwd,
					isMultiRootEnabled(this.stateManager),
				),
			})
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: `${userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n")}\n\nLoading...`,
			}),
		)

		await this.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: userContent,
			ts: Date.now(),
		})

		telemetryService.captureConversationTurnEvent(this.ulid, providerId, model.id, "user", modelInfo.mode)

		// Capture task initialization timing telemetry for the first API request
		if (isFirstRequest) {
			const durationMs = Math.round(performance.now() - this.taskInitializationStartTime)
			telemetryService.captureTaskInitialization(
				this.ulid,
				this.taskId,
				durationMs,
				this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting"),
			)
		}

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.messageStateHandler.clineMessages, (m) => m.say === "api_req_started")
		await this.messageStateHandler.updateClineMessage(lastApiReqIndex, {
			text: JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
			} satisfies ClineApiReqInfo),
		})
		await this.postStateToWebview()

		try {
			const taskMetrics: {
				cacheWriteTokens: number
				cacheReadTokens: number
				inputTokens: number
				outputTokens: number
				totalCost: number | undefined
			} = { cacheWriteTokens: 0, cacheReadTokens: 0, inputTokens: 0, outputTokens: 0, totalCost: undefined }
			let didFinalizeApiReqMsg = false
			let usageChunkSideEffectsQueue = Promise.resolve()
			/*
				Usage side effects run as soon as a usage chunk arrives.
				queueUsageChunkSideEffects() appends work to this promise chain, and each appended step starts immediately
				(once the previous step finishes). We only await usageChunkSideEffectsQueue at stream end to flush any in-flight
				updates before finalizing api_req_started, not to start processing.
			*/

			const updateApiReqMsgFromMetrics = async (
				cancelReason?: ClineApiReqCancelReason,
				streamingFailedMessage?: string,
			) => {
				await updateApiReqMsg({
					messageStateHandler: this.messageStateHandler,
					lastApiReqIndex,
					inputTokens: taskMetrics.inputTokens,
					outputTokens: taskMetrics.outputTokens,
					cacheWriteTokens: taskMetrics.cacheWriteTokens,
					cacheReadTokens: taskMetrics.cacheReadTokens,
					api: this.api,
					totalCost: taskMetrics.totalCost,
					cancelReason,
					streamingFailedMessage,
				})
			}

			const queueUsageChunkSideEffects = (
				usageInputTokens: number,
				usageOutputTokens: number,
				chunkOptions?: { cacheWriteTokens?: number; cacheReadTokens?: number; totalCost?: number },
			) => {
				usageChunkSideEffectsQueue = usageChunkSideEffectsQueue
					// This executes immediately after enqueue (microtask if already resolved), not at stream end.
					.then(async () => {
						if (didFinalizeApiReqMsg || this.taskState.abort) {
							return
						}

						await updateApiReqMsgFromMetrics()
						await this.postStateToWebview()
						await telemetryService.captureTokenUsage(
							this.ulid,
							usageInputTokens,
							usageOutputTokens,
							providerId,
							model.id,
							chunkOptions,
						)
					})
					.catch((error) => {
						Logger.debug(`[Task ${this.taskId}] Failed to process usage chunk side effects: ${error}`)
					})
			}

			const finalizeApiReqMsg = async (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				didFinalizeApiReqMsg = true
				await usageChunkSideEffectsQueue
				await updateApiReqMsgFromMetrics(cancelReason, streamingFailedMessage)
			}

			const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
				Session.get().finalizeRequest()

				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// if last message is a partial we need to finalize it in memory.
				// Do NOT push to frontend here — the Controller will later clear
				// partial flags and refresh via postStateToWebview.
				// Sending a partialMessageEvent would re-insert the message after clearing.
				const lastIndex = this.messageStateHandler.clineMessages.length - 1
				const lastMessage = this.messageStateHandler.clineMessages.at(-1)
				if (lastMessage?.partial) {
					await this.messageStateHandler.updateClineMessage(lastIndex, {
						partial: false,
					})
				}
				// update api_req_started to have cancelled and cost, so that we can display the cost of the partial stream
				await finalizeApiReqMsg(cancelReason, streamingFailedMessage)
				await this.messageStateHandler.updateTaskHistory()

				// Let assistant know their response was interrupted for when task is resumed
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text:
								assistantMessage +
								`\n\n[${
									cancelReason === "streaming_failed"
										? "Response interrupted by API Error"
										: "Response interrupted by user"
								}]`,
						},
					],
					modelInfo,
					metrics: {
						tokens: {
							prompt: taskMetrics.inputTokens,
							completion: taskMetrics.outputTokens,
							cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
						},
						cost: taskMetrics.totalCost,
					},
					ts: Date.now(),
				})

				telemetryService.captureConversationTurnEvent(
					this.ulid,
					providerId,
					modelInfo.modelId,
					"assistant",
					modelInfo.mode,
					undefined,
					this.useNativeToolCalls, // For assistant turn only.
				)

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.taskState.didFinishAbortingStream = true
			}

			// reset streaming state
			this.taskState.currentStreamingContentIndex = 0
			this.taskState.assistantMessageContent = []
			this.taskState.didCompleteReadingStream = false
			this.taskState.userMessageContent = []
			this.taskState.userMessageContentReady = false
			this.taskController.reset()
			this.taskState.didAlreadyUseTool = false
			this.taskState.presentAssistantMessageLocked = false
			this.taskState.presentAssistantMessageHasPendingUpdates = false
			this.taskState.didAutomaticallyRetryFailedApiRequest = false
			await this.diffViewProvider.reset()
			this.streamHandler.reset()
			this.presentationScheduler.reset()
			this.taskState.toolUseIdMap.clear()
			this.taskState.reasoningTs = undefined
			this.taskState.parseBlockTsByKey.clear()
			this.taskState.lastRenderedPartialByTs.clear()
			this.taskState.partialToolLifecycleByTs.clear()

			const { toolUseHandler, reasonsHandler } = this.streamHandler.getHandlers()
			const stream = this.attemptApiRequest(previousApiReqIndex) // yields only if the first chunk is successful, otherwise will allow the user to retry the request (most likely due to rate limit error, which gets thrown on the first chunk)

			let assistantMessageId = ""
			let assistantMessage = "" // For UI display (includes XML)
			let assistantTextOnly = "" // For API history (text only, no tool XML)
			let assistantTextSignature: string | undefined

			this.taskState.isStreaming = true
			let didReceiveUsageChunk = false
			let didFinalizeReasoningForUi = false
			let didScheduleAnyContent = false // Tracks whether any content chunk has been scheduled for presentation (not necessarily flushed yet)

			const finalizePendingReasoningMessage = async (thinking: string): Promise<boolean> => {
				const existingTs = this.taskState.reasoningTs
				if (existingTs === undefined) return false

				const finalized = await this.messageStateHandler.finalizeClineMessage({
					ts: existingTs,
					type: "say",
					say: "reasoning",
					text: thinking,
				} as any)
				if (finalized) {
					await sendPartialMessageEvent(this.controller, convertClineMessageToProto(finalized))
				}
				this.taskState.reasoningTs = undefined
				return true
			}

			// Track API call time for session statistics
			Session.get().startApiCall()
			let streamCoordinator: StreamChunkCoordinator | undefined

			try {
				streamCoordinator = new StreamChunkCoordinator(stream, {
					onUsageChunk: (chunk) => {
						this.streamHandler.setRequestId(chunk.id)
						didReceiveUsageChunk = true
						taskMetrics.inputTokens += chunk.inputTokens
						taskMetrics.outputTokens += chunk.outputTokens
						taskMetrics.cacheWriteTokens += chunk.cacheWriteTokens ?? 0
						taskMetrics.cacheReadTokens += chunk.cacheReadTokens ?? 0
						taskMetrics.totalCost = chunk.totalCost ?? taskMetrics.totalCost
						queueUsageChunkSideEffects(chunk.inputTokens, chunk.outputTokens, {
							cacheWriteTokens: chunk.cacheWriteTokens,
							cacheReadTokens: chunk.cacheReadTokens,
							totalCost: chunk.totalCost,
						})
					},
				})

				let shouldInterruptStream = false

				while (true) {
					const chunk = await streamCoordinator.nextChunk()
					if (!chunk) {
						break
					}
					// Track whether any content chunk has been scheduled for presentation (not necessarily flushed yet).
					// Using assistantMessage alone would miss reasoning-only streams where text hasn't
					// started yet, causing every reasoning chunk to get "immediate" priority.
					const hadVisibleAssistantContent = didScheduleAnyContent
					if (!this.taskState.taskFirstTokenTimeMs) {
						this.taskState.taskFirstTokenTimeMs = Math.max(0, Date.now() - this.taskState.taskStartTimeMs)
					}

					switch (chunk.type) {
						case "reasoning": {
							// Process the reasoning delta through the handler
							// Ensure details is always an array
							const details = chunk.details ? (Array.isArray(chunk.details) ? chunk.details : [chunk.details]) : []
							reasonsHandler.processReasoningDelta({
								id: chunk.id,
								reasoning: chunk.reasoning,
								signature: chunk.signature,
								details,
								redacted_data: chunk.redacted_data,
							})

							// fixes bug where cancelling task > aborts task > for loop may be in middle of streaming reasoning > say function throws error before we get a chance to properly clean up and cancel the task.
							if (!this.taskState.abort) {
								const thinkingBlock = reasonsHandler.getCurrentReasoning()
								const hasPendingNativeToolUse = toolUseHandler.getPartialToolUsesAsContent().length > 0
								// Some providers can interleave reasoning after text has started.
								// Keep rendering stable by only streaming reasoning UI before the first text chunk or native tool call.
								if (
									thinkingBlock?.thinking &&
									chunk.reasoning &&
									assistantMessage.length === 0 &&
									!hasPendingNativeToolUse
								) {
									const existingTs = this.taskState.reasoningTs
									const ts = await this.say(
										"reasoning",
										thinkingBlock.thinking,
										undefined,
										undefined,
										true,
										existingTs,
									)
									if (ts !== undefined && existingTs === undefined) {
										this.taskState.reasoningTs = ts
									}
								}
							}
							await this.scheduleAssistantPresentation(
								"reasoning",
								this.getPresentationPriorityForChunk({ chunkType: "reasoning", hadVisibleAssistantContent }),
							)
							didScheduleAnyContent = true

							break
						}
						case "tool_calls": {
							// Accumulate tool use blocks in proper Anthropic format
							toolUseHandler.processToolUseDelta(
								{
									id: chunk.tool_call.function?.id,
									type: "tool_use",
									name: chunk.tool_call.function?.name,
									input: chunk.tool_call.function?.arguments,
									signature: chunk?.signature,
								},
								chunk.tool_call.call_id,
							)
							// Extract and store tool_use_id for creating proper ToolResultBlockParam
							// Use call_id as key to support multiple calls to the same tool
							if (chunk.tool_call.function?.id && chunk.tool_call.call_id) {
								this.taskState.toolUseIdMap.set(chunk.tool_call.call_id, chunk.tool_call.function.id)
							}

							const currentReasoning = reasonsHandler.getCurrentReasoning()
							if (currentReasoning?.thinking && !didFinalizeReasoningForUi) {
								const ok = await finalizePendingReasoningMessage(currentReasoning.thinking)
								if (ok) {
									didFinalizeReasoningForUi = true
								}
							}

							await this.processNativeToolCalls(assistantTextOnly, toolUseHandler.getPartialToolUsesAsContent())
							await this.scheduleAssistantPresentation(
								"tool",
								this.getPresentationPriorityForChunk({ chunkType: "tool_calls", hadVisibleAssistantContent }),
							)
							didScheduleAnyContent = true
							break
						}
						case "text": {
							// If we have reasoning content, finalize it before processing text (only once)
							const currentReasoning = reasonsHandler.getCurrentReasoning()
							if (currentReasoning?.thinking && !didFinalizeReasoningForUi) {
								const finalizedReasoning = await finalizePendingReasoningMessage(currentReasoning.thinking)
								if (finalizedReasoning) {
									didFinalizeReasoningForUi = true
								}
							}
							if (chunk.signature) {
								assistantTextSignature = chunk.signature
							}
							if (chunk.id) {
								assistantMessageId = chunk.id
							}
							assistantMessage += chunk.text
							assistantTextOnly += chunk.text // Accumulate text separately
							// parse raw assistant message into content blocks
							const prevLength = this.taskState.assistantMessageContent.length
							const _prevBlocks = this.taskState.assistantMessageContent

							const nextBlocks = orderTurnEndingContentBlocks(
								parseAssistantMessageV2(assistantMessage, {
									getOrCreateTsForBlock: (key) => {
										const existing = this.taskState.parseBlockTsByKey.get(key)
										if (existing !== undefined) return existing
										const ts = this.genMessageTs()
										this.taskState.parseBlockTsByKey.set(key, ts)
										return ts
									},
								}),
							)
							this.taskState.assistantMessageContent = nextBlocks

							if (this.taskState.assistantMessageContent.length > prevLength) {
								this.taskState.userMessageContentReady = false // new content we need to present, reset to false in case previous content set this to true
							}
							await this.scheduleAssistantPresentation(
								"text",
								this.getPresentationPriorityForChunk({ chunkType: "text", hadVisibleAssistantContent }),
							)
							didScheduleAnyContent = true
							break
						}
					}

					if (this.taskState.abort) {
						this.api.abort?.()
						if (!this.taskState.abandoned) {
							// only need to gracefully abort if this instance isn't abandoned (sometimes openrouter stream hangs, in which case this would affect future instances of cline)
							await abortStream("user_cancelled")
						}
						shouldInterruptStream = true
						break // aborts the stream
					}

					if (this.taskController.hasAnyRejection()) {
						// userContent has a tool rejection, so interrupt the assistant's response to present the user's feedback
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// this.userMessageContentReady = true // instead of setting this preemptively, we allow the present iterator to finish and set userMessageContentReady when its ready
						shouldInterruptStream = true
						break
					}

					// Keep reading the current assistant response after a tool has run.
					// ToolExecutor skips additional non-terminal tools when parallel tool
					// calling is disabled, but terminal tools such as attempt_completion
					// may still arrive later in the same response and must be handled.
				}

				if (shouldInterruptStream) {
					await streamCoordinator.stop()
				} else {
					await streamCoordinator.waitForCompletion()
				}
				// Flush any usage updates that were already executing/queued during streaming.
				await usageChunkSideEffectsQueue

				if (!this.taskState.abort && !didFinalizeReasoningForUi) {
					const finalReasoning = reasonsHandler.getCurrentReasoning()
					if (finalReasoning?.thinking) {
						const finalizedPendingReasoning = await finalizePendingReasoningMessage(finalReasoning.thinking)
						if (!finalizedPendingReasoning) {
							await this.say("reasoning", finalReasoning.thinking, undefined, undefined, false)
						}
						didFinalizeReasoningForUi = true
					}
				}
			} catch (error) {
				await streamCoordinator?.stop()
				// abandoned happens when extension is no longer waiting for the cline instance to finish aborting (error is thrown here when any function in the for loop throws due to this.abort)
				if (!this.taskState.abandoned) {
					// Use provider-specific parseError if available, otherwise fall back to generic classification
					const clineError =
						this.api.parseError?.(error, this.api.getModel().id) ??
						ErrorService.get().toClineError(error, this.api.getModel().id)
					if (this.api.parseError) {
						ErrorService.get().logException(clineError, { modelId: this.api.getModel().id })
					}
					const errorMessage = clineError.serialize()
					const isStreamingSpendLimitError = clineError.isErrorType(ClineErrorType.SpendLimit)
					// Auto-retry for streaming failures (skip for spend limit errors)
					if (!isStreamingSpendLimitError && this.taskState.autoRetryAttempts < 3) {
						this.taskState.autoRetryAttempts++

						// Calculate exponential backoff for streaming failures: 2s, 4s, 8s
						const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)

						// API Request component is updated to show error message, we then display retry information underneath that...
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: this.taskState.autoRetryAttempts,
								maxAttempts: 3,
								delaySeconds: delay / 1000,
								errorMessage,
							}),
						)

						// Wait with exponential backoff before auto-resuming
						setTimeoutPromise(delay).then(async () => {
							// Programmatically click the resume button on the new task instance
							if (this.controller.task) {
								// Pass retry state to the new task instance
								this.controller.task.taskState.autoRetryAttempts = this.taskState.autoRetryAttempts
								await this.controller.task.handleWebviewAskResponse("yesButtonClicked", "", [])
							}
						})
					} else if (!isStreamingSpendLimitError && this.taskState.autoRetryAttempts >= 3) {
						// Show error_retry with failed flag to indicate all retries exhausted
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: 3,
								maxAttempts: 3,
								delaySeconds: 0,
								failed: true, // Special flag to indicate retries exhausted
								errorMessage,
							}),
						)
					}

					// needs to happen after the say, otherwise the say would fail
					await this.cancelTask() // stream exhausted retries; delegate to the full cancel flow

					await abortStream("streaming_failed", errorMessage)
					await this.reinitExistingTaskFromId(this.taskId)
				}
			} finally {
				this.taskState.isStreaming = false
				// End API call tracking for session statistics
				Session.get().endApiCall()
			}

			// Finalize any remaining tool calls at the end of the stream

			// OpenRouter/Cline may not return token usage as part of the stream (since it may abort early), so we fetch after the stream is finished
			// (updateApiReq below will update the api_req_started message with the usage details. we do this async so it updates the api_req_started message in the background)
			if (!didReceiveUsageChunk) {
				const apiStreamUsage = await this.api.getApiStreamUsage?.()
				if (apiStreamUsage) {
					taskMetrics.inputTokens += apiStreamUsage.inputTokens
					taskMetrics.outputTokens += apiStreamUsage.outputTokens
					taskMetrics.cacheWriteTokens += apiStreamUsage.cacheWriteTokens ?? 0
					taskMetrics.cacheReadTokens += apiStreamUsage.cacheReadTokens ?? 0
					taskMetrics.totalCost = apiStreamUsage.totalCost ?? taskMetrics.totalCost
					queueUsageChunkSideEffects(apiStreamUsage.inputTokens, apiStreamUsage.outputTokens, {
						cacheWriteTokens: apiStreamUsage.cacheWriteTokens,
						cacheReadTokens: apiStreamUsage.cacheReadTokens,
						totalCost: apiStreamUsage.totalCost,
					})
				}
			}

			// Update the api_req_started message with final usage and cost details
			await finalizeApiReqMsg()
			await this.messageStateHandler.updateTaskHistory()
			await this.postStateToWebview()

			// need to call here in case the stream was aborted
			if (this.taskState.abort) {
				throw new Error("Dline instance aborted")
			}

			// Stored the assistant API response immediately after the stream finishes in the same turn
			// Check if the stream produced any content ÃƒÂ¢Ã¢â€?either text or native tool calls.
			// toolUseHandler may have accumulated tool_use blocks even when useNativeToolCalls is false
			// (e.g., from Claude Code provider when the model returns native tool_use blocks).
			const hasAccumulatedToolCalls = toolUseHandler.getAllFinalizedToolUses().length > 0
			const hasReceivedReasoning = reasonsHandler.hasReceivedReasoning()
			const assistantHasContent =
				assistantMessage.length > 0 || this.useNativeToolCalls || hasAccumulatedToolCalls || hasReceivedReasoning
			if (assistantHasContent) {
				telemetryService.captureConversationTurnEvent(
					this.ulid,
					providerId,
					model.id,
					"assistant",
					modelInfo.mode,
					undefined,
					this.useNativeToolCalls,
				)

				const { reasonsHandler } = this.streamHandler.getHandlers()
				const redactedThinkingContent = reasonsHandler.getRedactedThinking()

				const requestId = this.streamHandler.requestId

				// Build content array with thinking blocks, text (if any), and tool use blocks
				const assistantContent: Array<ClineAssistantContent> = [
					// This is critical for maintaining the model's reasoning flow and conversation integrity.
					// "When providing thinking blocks, the entire sequence of consecutive thinking blocks must match the outputs generated by the model during the original request; you cannot rearrange or modify the sequence of these blocks." The signature_delta is used to verify that the thinking was generated by Claude, and the thinking blocks will be ignored if it's incorrect or missing.
					// https://docs.claude.com/en/docs/build-with-claude/extended-thinking#preserving-thinking-blocks
					...redactedThinkingContent,
				]
				// Add thinking block from the reasoning handler if available
				const thinkingBlock = reasonsHandler.getCurrentReasoning()
				if (thinkingBlock) {
					assistantContent.push({ ...thinkingBlock })
				}

				// Only add text block if there's actual text (not just tool XML)
				const hasAssistantText = assistantTextOnly.trim().length > 0
				if (hasAssistantText) {
					assistantContent.push({
						type: "text",
						text: assistantTextOnly,
						// reasoning_details only exists for cline/openrouter providers
						reasoning_details: thinkingBlock?.summary as any[],
						signature: assistantTextSignature,
						call_id: assistantMessageId,
					})
				}

				// Get finalized tool use blocks from the handler
				const toolUseBlocks = toolUseHandler.getAllFinalizedToolUses(
					// NOTE: If there is no assistant text but there is a thinking block, we attach the summary to the tool use blocks
					// for providers that required reasoning traces included with assistant content.
					hasAssistantText ? undefined : thinkingBlock?.summary,
				)
				const orderedToolUseBlocks = orderTurnEndingNativeToolBlocks(toolUseBlocks)
				// Append tool use blocks if any exist
				if (orderedToolUseBlocks.length > 0) {
					assistantContent.push(...orderedToolUseBlocks)
				}

				// Append the assistant's content to the API conversation history only if there's content
				if (assistantContent.length > 0) {
					await this.messageStateHandler.addToApiConversationHistory({
						role: "assistant",
						content: assistantContent,
						modelInfo,
						id: requestId,
						metrics: {
							tokens: {
								prompt: taskMetrics.inputTokens,
								completion: taskMetrics.outputTokens,
								cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
							},
							cost: taskMetrics.totalCost,
						},
						ts: Date.now(),
					})
				}
			}

			this.taskState.didCompleteReadingStream = true

			// set any blocks to be complete to allow presentAssistantMessage to finish and set userMessageContentReady to true
			// (could be a text block that had no subsequent tool uses, or a text block at the very end, or an invalid tool use, etc. whatever the case, presentAssistantMessage relies on these blocks either to be completed or the user to reject a block in order to proceed and eventually set userMessageContentReady to true)
			const partialBlocks = this.taskState.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => {
				block.partial = false
			})
			// in case there are native tool calls pending
			const partialToolBlocks = toolUseHandler.getPartialToolUsesAsContent()?.map((block) => ({ ...block, partial: false }))
			await this.processNativeToolCalls(assistantTextOnly, partialToolBlocks)
			await this.flushAssistantPresentationOrThrow() // finalization is immediate so no coalesced content remains pending

			// now add to apiconversationhistory
			// need to save assistant responses to file before proceeding to tool use since user can exit at any moment and we wouldn't be able to save the assistant's response
			let didEndLoop = false
			if (assistantHasContent) {
				// NOTE: this comment is here for future reference - this was a workaround for userMessageContent not getting set to true. It was due to it not recursively calling for partial blocks when didRejectTool, so it would get stuck waiting for a partial block to complete before it could continue.
				// in case the content blocks finished
				// it may be the api stream finished after the last parsed content block was executed, so  we are able to detect out of bounds and set userMessageContentReady to true (note you should not call presentAssistantMessage since if the last block is completed it will be presented again)
				// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // if there are any partial blocks after the stream ended we can consider them invalid
				// if (this.currentStreamingContentIndex >= completeBlocks.length) {
				// 	this.userMessageContentReady = true
				// }

				await pWaitFor(() => this.taskState.userMessageContentReady)

				// Save checkpoint after all tools in this response have finished executing
				await this.checkpointManager?.saveCheckpoint()

				// if the model did not tool use, then we need to tell it to either use a tool or attempt_completion
				const didToolUse = this.taskState.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					// normal request where tool use is required
					this.taskState.userMessageContent.push({
						type: "text",
						text: formatResponse.noToolsUsed(this.useNativeToolCalls),
					})
					this.taskState.consecutiveMistakeCount++
				}

				// Reset auto-retry counter for each new API request
				this.taskState.autoRetryAttempts = 0

				const recDidEndLoop = await this.recursivelyMakeClineRequests(this.taskState.userMessageContent)
				didEndLoop = recDidEndLoop
			} else {
				// if there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				const { model, providerId } = this.getCurrentProviderInfo()
				const reqId = this.getApiRequestIdSafe()

				// Minimal diagnostics: structured log and telemetry
				telemetryService.captureProviderApiError({
					ulid: this.ulid,
					model: model.id,
					provider: providerId,
					errorMessage: "empty_assistant_message",
					requestId: reqId,
					isNativeToolCall: this.useNativeToolCalls,
				})

				const baseErrorMessage =
					"Invalid API Response: The provider returned an empty or unparsable response. This is a provider-side issue where the model failed to generate valid output or returned tool calls that Cline cannot process. Retrying the request may help resolve this issue."
				const errorText = reqId ? `${baseErrorMessage} (Request ID: ${reqId})` : baseErrorMessage

				await this.say("error", errorText)
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Failure: I did not provide a response.",
						},
					],
					modelInfo,
					id: this.streamHandler.requestId,
					metrics: {
						tokens: {
							prompt: taskMetrics.inputTokens,
							completion: taskMetrics.outputTokens,
							cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
						},
						cost: taskMetrics.totalCost,
					},
					ts: Date.now(),
				})

				let response: ClineAskResponse

				const noResponseErrorMessage = "No assistant message was received. Would you like to retry the request?"

				if (this.taskState.autoRetryAttempts < 3) {
					// Auto-retry enabled with max 3 attempts: automatically approve the retry
					this.taskState.autoRetryAttempts++

					// Calculate delay: 2s, 4s, 8s
					const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)
					response = "yesButtonClicked"
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: this.taskState.autoRetryAttempts,
							maxAttempts: 3,
							delaySeconds: delay / 1000,
							errorMessage: noResponseErrorMessage,
						}),
					)
					await setTimeoutPromise(delay)
				} else {
					// Max retries exhausted (>= 3 attempts), ask user
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: 3,
							maxAttempts: 3,
							delaySeconds: 0,
							failed: true, // Special flag to indicate retries exhausted
							errorMessage: noResponseErrorMessage,
						}),
					)
					const askResult = await this.ask("api_req_failed", noResponseErrorMessage)
					response = askResult.response
					// Reset retry counter if user chooses to manually retry
					if (response === "yesButtonClicked") {
						this.taskState.autoRetryAttempts = 0
					}
				}

				if (response === "yesButtonClicked") {
					// Signal the loop to continue (i.e., do not end), so it will attempt again
					return false
				}

				// Returns early to avoid retry since user dismissed
				return true
			}

			return didEndLoop // will always be false for now
		} catch (_error) {
			// this should never happen since the only thing that can throw an error is the attemptApiRequest, which is wrapped in a try catch that sends an ask where if noButtonClicked, will clear current task and destroy this instance. However to avoid unhandled promise rejection, we will end this loop which will end execution of this instance (see startTask)
			return true // needs to be true so parent loop knows to end task
		}
	}

	async loadContext(
		userContent: ClineContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[ClineContent[], string, boolean]> {
		let needsClinerulesFileCheck = false

		// Pre-fetch necessary data to avoid redundant calls within loops
		const ulid = this.ulid
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		const useNativeToolCalls = this.stateManager.getGlobalStateKey("nativeToolCallEnabled")
		const providerInfo = this.getCurrentProviderInfo()
		const cwd = this.cwd
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(this.controller, cwd)

		// Refresh skill toggles so slash commands and the frontend pick up newly added skills.
		// This mirrors the workflow toggle refresh pattern.
		await refreshSkills(this.controller)

		const hasUserContentTag = (text: string): boolean => {
			return USER_CONTENT_TAGS.some((tag) => text.includes(tag))
		}

		const parseTextBlock = async (text: string): Promise<string> => {
			const parsedText = await parseMentions(
				text,
				cwd,
				this.urlContentFetcher,
				this.fileContextTracker,
				this.workspaceManager,
			)

			// Create MCP prompt fetcher callback that wraps mcpHub.getPrompt
			const mcpPromptFetcher = async (serverName: string, promptName: string) => {
				try {
					return await this.mcpHub.getPrompt(serverName, promptName)
				} catch {
					return null
				}
			}

			const { processedText, needsClinerulesFileCheck: needsCheck } = await parseSlashCommands(
				parsedText,
				localWorkflowToggles,
				globalWorkflowToggles,
				ulid,
				focusChainSettings,
				useNativeToolCalls,
				providerInfo,
				mcpPromptFetcher,
			)

			if (needsCheck) {
				needsClinerulesFileCheck = true
			}

			return processedText
		}

		const processTextContent = async (block: ClineTextContentBlock): Promise<ClineTextContentBlock> => {
			if (block.type !== "text" || !hasUserContentTag(block.text)) {
				return block
			}

			const processedText = await parseTextBlock(block.text)
			return { ...block, text: processedText }
		}

		const processContentBlock = async (block: ClineContent): Promise<ClineContent> => {
			if (block.type === "text") {
				return processTextContent(block)
			}

			if (block.type === "tool_result") {
				if (!block.content) {
					return block
				}

				// Handle string content
				if (typeof block.content === "string") {
					const processed = await processTextContent({ type: "text", text: block.content })
					// Creates NEW object and turns the string content as array
					return { ...block, content: [processed] }
				}

				// Handle array content
				if (Array.isArray(block.content)) {
					const processedContent = await Promise.all(
						block.content.map(async (contentBlock) => {
							return contentBlock.type === "text" ? processTextContent(contentBlock) : contentBlock
						}),
					)

					return { ...block, content: processedContent }
				}
			}

			return block
		}

		// Process all content and environment details in parallel
		// NOTE: (Ara) This is a temporary solution to dynamically load context mentions from tool results. It checks for the presence of tags that indicate that the tool was rejected and feedback was provided (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions). However if we allow multiple tools responses in the future, we will need to parse mentions specifically within the user content tags.
		// (Note: this caused the @/ import alias bug where file contents were being parsed as well, since v2 converted tool results to text blocks)
		const [processedUserContent, environmentDetails] = await Promise.all([
			Promise.all(userContent.map(processContentBlock)),
			this.getEnvironmentDetails(includeFileDetails),
		])

		// Check clinerulesData if needed
		const clinerulesError = needsClinerulesFileCheck
			? await ensureLocalClineDirExists(this.cwd, GlobalFileNames.dlineRulesDir)
			: false

		// Add focus chain instructions if needed
		if (!useCompactPrompt && this.FocusChainManager?.shouldIncludeFocusChainInstructions()) {
			const focusChainInstructions = this.FocusChainManager.generateFocusChainInstructions()
			if (focusChainInstructions.trim()) {
				processedUserContent.push({
					type: "text",
					text: focusChainInstructions,
				})

				this.taskState.apiRequestsSinceLastTodoUpdate = 0
				this.taskState.todoListWasUpdatedByUser = false
			}
		}

		return [processedUserContent, environmentDetails, clinerulesError]
	}

	protected async processNativeToolCalls(assistantTextOnly: string, toolBlocks: ToolUse[]) {
		if (!toolBlocks?.length) {
			return
		}
		// For native tool calls, mark all pending tool uses as complete
		const prevLength = this.taskState.assistantMessageContent.length

		// Get finalized tool uses and mark them as complete
		const textContent = assistantTextOnly.trim()
		const prevTextBlock = this.taskState.assistantMessageContent.find((b) => b.type === "text") as
			| TextStreamContent
			| undefined
		// Use prevTextBlock.ts for the new text block so state and UI finalization share the same ts.
		const textTs = prevTextBlock?.ts ?? this.genMessageTs()
		const textBlocks: AssistantMessageContent[] = textContent
			? [{ type: "text", content: textContent, partial: false, ts: textTs }]
			: []

		// Finalize partial text using block.ts from prev text block.
		// Only finalize if the previous block is still partial; skipping
		// non-partial blocks avoids repeated finalize events on every native
		// tool_calls chunk.
		if (textBlocks.length > 0 && prevTextBlock?.partial) {
			if (prevTextBlock?.ts !== undefined) {
				await this.say("text", textContent, undefined, undefined, false, textTs)
			}
		}

		// Snapshot the existing tool call_ids BEFORE replacing content so we can
		// detect whether the incoming chunk introduces novel tools. Using the
		// post-replacement content for detection would always report "no new tools"
		// since nextBlocks already contains them.
		const prevContent = this.taskState.assistantMessageContent
		const existingCallIds = new Set(
			prevContent.filter((b): b is ToolUse => b.type === "tool_use" && !!b.call_id).map((b) => b.call_id),
		)

		const nextBlocks = orderTurnEndingContentBlocks([...textBlocks, ...toolBlocks])
		this.taskState.assistantMessageContent = nextBlocks

		// Only reset index if there are actually new tool blocks that haven't been
		// executed yet. Collecting call_ids from the previous content lets us detect
		// whether this chunk introduces novel tools. Without this check, every
		// tool_calls chunk unconditionally resets currentStreamingContentIndex back
		// to the first tool, causing already-executed tools to re-run and produce
		// diff_error ("search patterns that don't match anything") on the second
		// pass because the file was already modified.
		if (toolBlocks.length > 0) {
			// Detect whether any tool in the new set is truly novel (call_id not seen before)
			const hasNewTools = toolBlocks.some((b) => b.call_id && !existingCallIds.has(b.call_id))

			if (hasNewTools || prevLength === 0) {
				// Find the first tool block whose lifecycle is NOT "complete-done".
				// Tools that already finished execution are skipped so they are
				// never re-executed when the index rewinds.
				const firstUnexecutedIndex = nextBlocks.findIndex((block) => {
					if (block.type !== "tool_use" || block.ts === undefined) return false
					const lifecycle = this.taskState.partialToolLifecycleByTs?.get(block.ts)
					return lifecycle !== "complete-done"
				})
				if (firstUnexecutedIndex !== -1) {
					this.taskState.currentStreamingContentIndex = firstUnexecutedIndex
				}
				this.taskState.userMessageContentReady = false
			}
		} else if (nextBlocks.length > prevLength) {
			this.taskState.userMessageContentReady = false
		}
	}

	/**
	 * Format workspace roots section for multi-root workspaces
	 */
	private formatWorkspaceRootsSection(): string {
		const multiRootEnabled = isMultiRootEnabled(this.stateManager)
		const hasWorkspaceManager = !!this.workspaceManager
		const roots = hasWorkspaceManager ? this.workspaceManager!.getRoots() : []

		// Only show workspace roots if multi-root is enabled and there are multiple roots
		if (!multiRootEnabled || roots.length <= 1) {
			return ""
		}

		let section = "\n\n# Workspace Roots"

		// Format each root with its name, path, and VCS info
		for (const root of roots) {
			const name = root.name || path.basename(root.path)
			const vcs = root.vcs ? ` (${String(root.vcs)})` : ""
			section += `\n- ${name}: ${root.path}${vcs}`
		}

		// Add primary workspace information
		const primary = this.workspaceManager?.getPrimaryRoot()
		const primaryName = this.getPrimaryWorkspaceName(primary)
		section += `\n\nPrimary workspace: ${primaryName}`

		return section
	}

	/**
	 * Get the display name for the primary workspace
	 */
	private getPrimaryWorkspaceName(primary?: ReturnType<WorkspaceRootManager["getRoots"]>[0]): string {
		if (primary?.name) {
			return primary.name
		}
		if (primary?.path) {
			return path.basename(primary.path)
		}
		return path.basename(this.cwd)
	}

	/**
	 * Format the file details header based on workspace configuration
	 */
	private formatFileDetailsHeader(): string {
		const multiRootEnabled = isMultiRootEnabled(this.stateManager)
		const roots = this.workspaceManager?.getRoots() || []

		if (multiRootEnabled && roots.length > 1) {
			const primary = this.workspaceManager?.getPrimaryRoot()
			const primaryName = this.getPrimaryWorkspaceName(primary)
			return `\n\n# Current Working Directory (Primary: ${primaryName}) Files\n`
		}
		return `\n\n# Current Working Directory (${this.cwd.toPosix()}) Files\n`
	}

	async getEnvironmentDetails(includeFileDetails = false) {
		const host = await HostProvider.env.getHostVersion({})
		let details = ""

		// Dline extension version (all builds)
		details += `# Dline Version\n${host.clineVersion || "unknown"}`

		// Workspace roots (multi-root)
		details += this.formatWorkspaceRootsSection()

		// It could be useful for cline to know if the user went from one or no file to another between messages, so we always include this context
		details += `\n\n# ${host.platform} Visible Files`
		const rawVisiblePaths = (await HostProvider.window.getVisibleTabs({})).paths
		const filteredVisiblePaths = await filterExistingFiles(rawVisiblePaths)
		const visibleFilePaths = filteredVisiblePaths.map((absolutePath) => path.relative(this.cwd, absolutePath))

		// Filter paths through clineIgnoreController
		const allowedVisibleFiles = this.clineIgnoreController
			.filterPaths(visibleFilePaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedVisibleFiles) {
			details += `\n${allowedVisibleFiles}`
		} else {
			details += "\n(No visible files)"
		}

		details += `\n\n# ${host.platform} Open Tabs`
		const rawOpenTabPaths = (await HostProvider.window.getOpenTabs({})).paths
		const filteredOpenTabPaths = await filterExistingFiles(rawOpenTabPaths)
		const openTabPaths = filteredOpenTabPaths.map((absolutePath) => path.relative(this.cwd, absolutePath))

		// Filter paths through clineIgnoreController
		const allowedOpenTabs = this.clineIgnoreController
			.filterPaths(openTabPaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedOpenTabs) {
			details += `\n${allowedOpenTabs}`
		} else {
			details += "\n(No open tabs)"
		}

		const busyTerminals = this.terminalManager.getTerminals(true)
		const inactiveTerminals = this.terminalManager.getTerminals(false)
		// const allTerminals = [...busyTerminals, ...inactiveTerminals]

		if (busyTerminals.length > 0 && this.taskState.didEditFile) {
			//  || this.didEditFile
			await setTimeoutPromise(300) // delay after saving file to let terminals catch up
		}
		// let terminalWasBusy = false
		if (busyTerminals.length > 0) {
			// wait for terminals to cool down
			// terminalWasBusy = allTerminals.some((t) => this.terminalManager.isProcessHot(t.id))
			await pWaitFor(() => busyTerminals.every((t) => !this.terminalManager.isProcessHot(t.id)), {
				interval: 100,
				timeout: 15_000,
			}).catch(() => {})
		}

		this.taskState.didEditFile = false // reset, this lets us know when to wait for saved files to update terminals

		// waiting for updated diagnostics lets terminal output be the most up-to-date possible
		let terminalDetails = ""
		if (busyTerminals.length > 0) {
			// terminals are cool, let's retrieve their output
			terminalDetails += "\n\n# Actively Running Terminals"
			for (const busyTerminal of busyTerminals) {
				terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``
				const newOutput = this.terminalManager.getUnretrievedOutput(busyTerminal.id)
				if (newOutput) {
					terminalDetails += `\n### New Output\n${newOutput}`
				} else {
					// details += `\n(Still running, no new output)` // don't want to show this right after running the command
				}
			}
		}
		// only show inactive terminals if there's output to show
		if (inactiveTerminals.length > 0) {
			const inactiveTerminalOutputs = new Map<number, string>()
			for (const inactiveTerminal of inactiveTerminals) {
				const newOutput = this.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
				if (newOutput) {
					inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
				}
			}
			if (inactiveTerminalOutputs.size > 0) {
				terminalDetails += "\n\n# Inactive Terminals"
				for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
					const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
					if (inactiveTerminal) {
						terminalDetails += `\n## ${inactiveTerminal.lastCommand}`
						terminalDetails += `\n### New Output\n${newOutput}`
					}
				}
			}
		}

		if (terminalDetails) {
			details += terminalDetails
		}

		// Add recently modified files section
		const recentlyModifiedFiles = this.fileContextTracker.getAndClearRecentlyModifiedFiles()
		if (recentlyModifiedFiles.length > 0) {
			details +=
				"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
			for (const filePath of recentlyModifiedFiles) {
				details += `\n${filePath}`
			}
		}

		// Add current time information with timezone
		const now = new Date()
		const formatter = new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hour12: true,
		})
		const timeZone = formatter.resolvedOptions().timeZone
		const timeZoneOffset = -now.getTimezoneOffset() / 60 // Convert to hours and invert sign to match conventional notation
		const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`
		details += `\n\n# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`

		if (includeFileDetails) {
			details += this.formatFileDetailsHeader()
			const isDesktop = arePathsEqual(this.cwd, getDesktopDir())
			if (isDesktop) {
				// don't want to immediately access desktop since it would show permission popup
				details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
			} else {
				const [fileInfos, didHitLimit] = await listFiles(this.cwd, true, 200)
				const result = formatResponse.formatFilesList(this.cwd, fileInfos, didHitLimit, this.clineIgnoreController)
				details += result
			}

			// Add workspace information in JSON format
			if (this.workspaceManager) {
				const workspacesJson = await this.workspaceManager.buildWorkspacesJson()
				if (workspacesJson) {
					details += `\n\n# Workspace Configuration\n${workspacesJson}`
				}
			}

			// Add detected CLI tools
			const availableCliTools = await detectAvailableCliTools()
			if (availableCliTools.length > 0) {
				details += `\n\n# Detected CLI Tools\nThese are some of the tools on the user's machine, and may be useful if needed to accomplish the task: ${availableCliTools.join(", ")}. This list is not exhaustive, and other tools may be available.`
			}
		}

		// Add context window usage information (conditionally for some models)
		const { contextWindow } = getContextWindowInfo(this.api)

		// Get the token count from the most recent API request to accurately reflect context management
		const getTotalTokensFromApiReqMessage = (msg: ClineMessage) => {
			if (!msg.text) {
				return 0
			}
			try {
				const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(msg.text)
				return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
			} catch (_e) {
				return 0
			}
		}

		const clineMessages = this.messageStateHandler.clineMessages
		const modifiedMessages = combineApiRequests(combineCommandSequences(clineMessages.slice(1)))
		const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
			if (msg.say !== "api_req_started") {
				return false
			}
			return getTotalTokensFromApiReqMessage(msg) > 0
		})

		const lastApiReqTotalTokens = lastApiReqMessage ? getTotalTokensFromApiReqMessage(lastApiReqMessage) : 0
		const usagePercentage = Math.round((lastApiReqTotalTokens / contextWindow) * 100)

		// Determine if context window info should be displayed
		const currentModelId = this.api.getModel().id
		const isNextGenModel = isClaude4PlusModelFamily(currentModelId) || isGPT5ModelFamily(currentModelId)

		let shouldShowContextWindow = true
		// For next-gen models, only show context window usage if it exceeds a certain threshold
		if (isNextGenModel) {
			const autoCondenseThreshold = 0.75
			const displayThreshold = autoCondenseThreshold - 0.15
			const currentUsageRatio = lastApiReqTotalTokens / contextWindow
			shouldShowContextWindow = currentUsageRatio >= displayThreshold
		}

		if (shouldShowContextWindow) {
			details += "\n\n# Context Window Usage"
			details += `\n${lastApiReqTotalTokens.toLocaleString()} / ${(contextWindow / 1000).toLocaleString()}K tokens used (${usagePercentage}%)`
			// Notify AI that auto-compact is enabled so it doesn't refuse long tasks
			const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")
			if (useAutoCondense) {
				details += "\n\nAuto-Compact is enabled. Context will be automatically compacted as needed."
			}
		}

		details += "\n\n# Current Mode"
		const mode = this.taskSm.mode
		if (mode === "plan") {
			details += `\nPLAN MODE\n${formatResponse.planModeInstructions()}`
		} else {
			details += "\nACT MODE"
		}

		// Add focus chain task_progress status if enabled and checklist exists
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		if (focusChainSettings?.enabled && this.taskState.currentFocusChainChecklist) {
			const checklist = this.taskState.currentFocusChainChecklist
			const inProgressIdx = this.taskState.currentInProgressItemIndex
			let renderedChecklist = checklist
			// Dynamically append <- CURRENT marker to the in-progress item
			if (inProgressIdx !== null && inProgressIdx >= 0) {
				const lines = checklist.split("\n")
				let itemCount = 0
				for (let i = 0; i < lines.length; i++) {
					if (isFocusChainItem(lines[i].trim())) {
						if (itemCount === inProgressIdx) {
							lines[i] = `${lines[i]} <- CURRENT`
							break
						}
						itemCount++
					}
				}
				renderedChecklist = lines.join("\n")
			}
			details += `\n\n# task_progress\n${renderedChecklist}`
		}

		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}
}
