import type { Anthropic } from "@anthropic-ai/sdk"
import { AccountUsage, buildApiHandler } from "@core/api"
import { getProfileModelInfo } from "@core/api/model-info"
import { readContextTokens } from "@core/context/context-management/context-pressure"
import { findEnabledProfileByName, findEnabledProfiles } from "@core/controller/file/getApiProfiles"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { TaskLockService } from "@core/locks/TaskLockService"
import * as SecretsManager from "@core/storage/secrets"
import { projectTaskView } from "@core/task/view/TaskViewProjector"
import { detectWorkspaceRoots } from "@core/workspace/detection"
import { setupWorkspaceManager } from "@core/workspace/setup"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"
import { ClineAccountService } from "@services/account/ClineAccountService"
import { McpHub } from "@services/mcp/McpHub"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { ExtensionState, Platform } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog, McpMarketplaceItem } from "@shared/mcp"
import type { ModeSwitchRequestResult } from "@shared/mode-switch"
import type { TaskLockStatus } from "@shared/proto/dline/task"
import { type Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import open from "open"
import * as path from "path"
import { ClineEnv } from "@/config"
import { getDlineDocumentsPath, getDlineDocumentsPathSync, getTaskHeaderText } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { AuthService } from "@/services/auth/AuthService"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { LogoutReason } from "@/services/auth/types"
import { featureFlagsService } from "@/services/feature-flags"
import { getDistinctId } from "@/services/logging/distinctId"
import { telemetryService } from "@/services/telemetry"
import { ClineExtensionContext } from "@/shared/cline"
import { getAxiosSettings } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/dline/host/window"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { getLatestAnnouncementId } from "@/utils/announcements"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ModelRegistry } from "../model-registry/ModelRegistry"
import { ApiConversation } from "../storage/ApiConversation"
import {
	ensureCacheDirectoryExists,
	ensureMcpServersDirectoryExists,
	ensureSettingsDirectoryExists,
	GlobalFileNames,
	writeMcpMarketplaceCatalogToCache,
} from "../storage/disk"
import { readJsonl } from "../storage/jsonl-utils"
import { fetchRemoteConfig } from "../storage/remote-config/fetch"
import { clearRemoteConfig } from "../storage/remote-config/utils"
import { type PersistenceErrorEvent, StateManager } from "../storage/StateManager"
import { UIMessage } from "../storage/UIMessage"
import { Task } from "../task"
import { sendMcpMarketplaceCatalogEvent } from "./mcp/subscribeToMcpMarketplaceCatalog"
import { ModeSwitchCoordinator } from "./mode-switch/ModeSwitchCoordinator"
import type { ModeSwitchOperation, ResolvedModeProfile } from "./mode-switch/types"
import { getClineOnboardingModels } from "./models/getClineOnboardingModels"
import { appendClineStealthModels } from "./models/refreshOpenRouterModels"
import { checkCliInstallation } from "./state/checkCliInstallation"
import { sendStateUpdate } from "./state/subscribeToState"
import { sendChatButtonClickedEvent } from "./ui/subscribeToChatButtonClicked"

type InitTaskOptions = {
	onHistoryTaskReadyToDisplay?: () => Promise<void>
	/** Context fragments for spawned or new tasks. Each entry becomes an independent text block for cache-friendly design. */
	context?: string[]
}

type PostStateOptions = {
	immediate?: boolean
}

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class Controller {
	task?: Task

	mcpHub: McpHub
	accountService: ClineAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService
	readonly stateManager: StateManager
	readonly lockService: TaskLockService

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	// Flag to prevent duplicate cancellations from spam clicking
	private cancelInProgress = false

	private readonly modeSwitchCoordinator: ModeSwitchCoordinator
	private nextStateRevision = 0
	private latestStateRevision = 0

	// Timer for periodic remote config fetching
	private remoteConfigTimer?: NodeJS.Timeout
	// Timer for periodic account usage polling
	private accountUsageTimer?: NodeJS.Timeout
	private accountUsagePollGeneration = 0
	// Timer for periodic lock heartbeat (keeps .lock file fresh)
	private lockHeartbeatTimer?: NodeJS.Timeout
	// Timer for polling lock status when task is in read-only mode
	private lockPollTimer?: NodeJS.Timeout
	// Whether the current task has an active lock
	private taskLockAcquired = false
	// Account usage data (refreshed every 60s, zero overhead on state push)
	private _accountUsage?: AccountUsage
	// Disposal function returned by StateManager.registerCallbacks().
	// Invoked in dispose() to unregister this controller from global
	// state-change notifications so closed windows don't keep receiving them.
	private stateManagerCallbacksDispose?: () => void

	/** Public getter for account usage data, used by subscribeToState/getLatestState. */
	getAccountUsage(): AccountUsage | undefined {
		return this._accountUsage
	}

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		if (!this.workspaceManager) {
			try {
				this.workspaceManager = await setupWorkspaceManager({
					stateManager: this.stateManager,
					detectRoots: detectWorkspaceRoots,
				})
			} catch (error) {
				Logger.error("[Controller] Failed to initialize workspace manager:", error)
			}
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		return this.workspaceManager
	}

	/**
	 * Starts the periodic remote config fetching timer
	 * Fetches immediately and then every hour
	 */
	private startRemoteConfigTimer() {
		// Initial fetch
		fetchRemoteConfig(this)
		// Set up 1-hour interval
		this.remoteConfigTimer = setInterval(() => fetchRemoteConfig(this), 3600000) // 1 hour
	}

	constructor(readonly context: ClineExtensionContext) {
		Session.reset() // Reset session on controller initialization
		this.stateManager = StateManager.get()
		this.stateManagerCallbacksDispose = StateManager.get().registerCallbacks({
			onPersistenceError: async ({ error }: PersistenceErrorEvent) => {
				// Just log - don't call reInitialize() (that sets isInitialized=false which
				// breaks running tasks) and don't show a warning (data is safe in memory
				// and will be retried automatically on the next debounced persistence).
				Logger.error("[Controller] Storage persistence failed (will retry):", error)
			},
			onSyncExternalChange: async () => {
				await this.postStateToWebview()
			},
		})
		this.authService = AuthService.getInstance(this)
		this.ocaAuthService = OcaAuthService.initialize(this)
		this.accountService = ClineAccountService.getInstance()
		this.modeSwitchCoordinator = this.createModeSwitchCoordinator()

		this.authService.restoreRefreshTokenAndRetrieveAuthInfo().then(() => {
			this.startRemoteConfigTimer()
		})

		this.mcpHub = McpHub.getSharedInstance(
			() => ensureMcpServersDirectoryExists(),
			() => ensureSettingsDirectoryExists(),
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints().catch((error) => {
			Logger.error("Failed to cleanup legacy checkpoints:", error)
		})

		// Check CLI installation status once on startup
		checkCliInstallation(this)

		// Initialize lock service with file-based locks under the tasks directory
		const tasksBasePath = path.join(getDlineDocumentsPathSync(), "tasks")
		this.lockService = new TaskLockService(tasksBasePath, `vscode-${crypto.randomUUID()}`)

		// Start account usage polling independent of tasks
		this.startAccountUsagePolling()
		Logger.log("[Controller] ClineProvider instantiated")
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		// Clear the remote config timer
		if (this.remoteConfigTimer) {
			clearInterval(this.remoteConfigTimer)
			this.remoteConfigTimer = undefined
		}

		// Stop the account usage polling timer to prevent background
		// postStateToWebview calls after the controller is disposed.
		this.stopAccountUsagePolling()

		await this.clearTask()
		this.mcpHub.dispose()

		// Clean up lock resources
		this.lockService.cleanupOrphaned().catch((e) => Logger.error("Lock cleanup failed:", e))

		// Unregister from the orchestrator so the controller is not
		// retained in the registry after disposal (spawn / panel tasks).
		const taskId = this.task?.taskId
		if (taskId) {
			const { OrchestratorController } = await import("@/core/orchestrator/OrchestratorController")
			OrchestratorController.getInstance().unregisterController(taskId)
		}

		// Clean up per-controller gRPC subscription sets so dead streams
		// from MCP / model updates don't accumulate in global maps.
		const { cleanupMcpSubscriptions } = await import("./mcp/subscribeToMcpServers")
		const { cleanupOpenRouterSubscriptions } = await import("./models/subscribeToOpenRouterModels")
		const { cleanupLiteLlmSubscriptions } = await import("./models/subscribeToLiteLlmModels")
		cleanupMcpSubscriptions(this)
		cleanupOpenRouterSubscriptions(this)
		cleanupLiteLlmSubscriptions(this)

		// Unregister from StateManager so this controller no longer
		// receives external state-change notifications.
		this.stateManagerCallbacksDispose?.()

		Logger.error("Controller disposed")
	}

	// Auth methods
	async handleSignOut() {
		try {
			// AuthService now handles its own storage cleanup in handleDeauth()
			this.stateManager.setGlobalState("userInfo", undefined)
			clearRemoteConfig()

			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Successfully logged out of Cline",
			})
		} catch (_error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Logout failed",
			})
		}
	}

	// Oca Auth methods
	async handleOcaSignOut() {
		try {
			await this.ocaAuthService.handleDeauth(LogoutReason.USER_INITIATED)
			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Successfully logged out of OCA",
			})
		} catch (_error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "OCA Logout failed",
			})
		}
	}

	async setUserInfo(info?: UserInfo) {
		this.stateManager.setGlobalState("userInfo", info)
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
		options?: InitTaskOptions,
	) {
		// Fire-and-forget: We intentionally don't await fetchRemoteConfig here.
		// Remote config is already fetched in startRemoteConfigTimer() which runs in the constructor,
		// so enterprise policies (yoloModeAllowed, allowedMCPServers, etc.) are already applied.
		// This call just ensures we have the latest state, but we shouldn't block the UI for it.
		// getGlobalSettingsKey() reads from remoteConfigCache on each call, so any updates
		// will apply as soon as this fetch completes. The function also calls postStateToWebview()
		// when done and catches all errors internally.
		fetchRemoteConfig(this)

		await this.clearTask() // ensures that an existing task doesn't exist before starting a new one, although this shouldn't be possible since user must clear task before starting a new one

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")

		const NEW_USER_TASK_COUNT_THRESHOLD = 10

		// Check if the user has completed enough tasks to no longer be considered a "new user"
		if (isNewUser && !historyItem && taskHistory && taskHistory.length >= NEW_USER_TASK_COUNT_THRESHOLD) {
			this.stateManager.setGlobalState("isNewUser", false)
			await this.postStateToWebview()
		}

		if (autoApprovalSettings) {
			const updatedAutoApprovalSettings = {
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
			}
			this.stateManager.setGlobalState("autoApprovalSettings", updatedAutoApprovalSettings)
		}

		// Initialize and persist the workspace manager (multi-root or single-root) with telemetry + fallback
		this.workspaceManager = await setupWorkspaceManager({
			stateManager: this.stateManager,
			detectRoots: detectWorkspaceRoots,
		})

		const cwd = this.workspaceManager?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))

		const taskId = historyItem?.id || Date.now().toString()

		// Acquire task lock via lock service
		this.taskLockAcquired = await this.lockService.acquireTaskLock(taskId)
		if (this.taskLockAcquired) {
			Logger.debug(`[Task ${taskId}] Task lock acquired`)
			this.lockHeartbeatTimer = setInterval(() => {
				this.lockService.touchTaskLock(taskId).catch(() => {})
			}, 60000)
		} else {
			Logger.debug(`[Task ${taskId}] Task locked by another instance - read-only mode`)
			// Start polling for lock release in the background
			this.startLockPoll(taskId)
		}

		await this.stateManager.loadTaskSettings(taskId)
		if (taskSettings) {
			this.stateManager.setTaskSettingsBatch(taskId, taskSettings)
		}

		// New task: inherit mode from the welcome-screen global setting.
		// Resumed tasks already have their mode persisted via loadTaskSettings.
		const taskCache = this.stateManager.getTaskCacheRef(taskId)
		if (!taskCache.mode) {
			const globalMode = this.stateManager.getGlobalSettingsKey("mode")
			this.stateManager.setTaskSettings(taskId, "mode", globalMode || "plan")
			Logger.debug(`[Task ${taskId}] initialized task-level mode from global: ${globalMode || "plan"}`)
		}

		// If restoring from history and HistoryItem has provider info, inject it
		// as task-specific settings so the task resumes with the same provider.
		// Mode is persisted separately via setTaskSettings in togglePlanActMode
		// and restored by loadTaskSettings above �?do NOT override it from historyItem.
		const uiMessage = await UIMessage.open(taskId)
		const apiConversation = await ApiConversation.open(taskId)

		this.task = new Task({
			controller: this,
			mcpHub: this.mcpHub,
			updateTaskHistory: (historyItem) => this.updateTaskHistory(historyItem),
			postStateToWebview: (options) => this.postStateToWebview(options),
			reinitExistingTaskFromId: (taskId) => this.reinitExistingTaskFromId(taskId),
			cancelTask: () => this.cancelTask(),
			shellIntegrationTimeout,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			vscodeTerminalExecutionMode,
			cwd,
			stateManager: this.stateManager,
			workspaceManager: this.workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			uiMessage,
			apiConversation,
		})
		const taskInstance = this.task
		const initializedTaskId = taskInstance.taskId

		// Register this controller so active task discovery covers every initTask path.
		const { OrchestratorController } = await import("@/core/orchestrator/OrchestratorController")
		OrchestratorController.getInstance().registerController(initializedTaskId, this)

		void this.persistPanelStateIfNeeded(initializedTaskId)

		try {
			if (historyItem) {
				await taskInstance.displayHistory()
				if (this.task !== taskInstance) {
					return initializedTaskId
				}
				if (this.taskLockAcquired) {
					await taskInstance.resumeFromHistory({
						onReadyToDisplay: options?.onHistoryTaskReadyToDisplay,
					})
				}
				// Readonly (taskLockAcquired === false): display-only, no interactive resume.
				// Frontend shows a lock banner with a force-unlock button.
			} else if (task || images || files) {
				await taskInstance.startTask(task, images, files, options?.context)
			}
		} finally {
			// Polling is started once in the constructor and is a controller-
			// lifetime concern — it should NOT be restarted per-task to avoid
			// creating duplicate, un-clearable intervals.
		}

		// Brief yield to let the UI frame render before pushing state.
		// Previously was 1000ms; reduced to a single microtask tick since
		// history resumes can push immediate state before navigating.
		await new Promise((r) => setTimeout(r, 0))
		if (this.task !== taskInstance) {
			return initializedTaskId
		}
		await this.postStateToWebview()
		if (this.task !== taskInstance) {
			return initializedTaskId
		}
		void this.syncPanelTitle(task || historyItem?.task || "Dline")
		void this.persistPanelStateIfNeeded(initializedTaskId)

		return initializedTaskId
	}

	async reinitExistingTaskFromId(taskId: string) {
		const history = await this.getTaskWithId(taskId)
		if (history) {
			await this.initTask(undefined, undefined, undefined, history.historyItem)
		}
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting) {
		// Get previous setting to detect state changes
		const previousSetting = this.stateManager.getGlobalSettingsKey("telemetrySetting")
		const wasOptedIn = previousSetting !== "disabled"
		const isOptedIn = telemetrySetting !== "disabled"

		// Capture opt-out event BEFORE updating (so it gets sent while telemetry is still enabled)
		if (wasOptedIn && !isOptedIn) {
			telemetryService.captureUserOptOut()
		}

		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		telemetryService.updateTelemetryState(isOptedIn)

		// Capture opt-in event AFTER updating (so telemetry is enabled to receive it)
		if (!wasOptedIn && isOptedIn) {
			telemetryService.captureUserOptIn()
		}

		await this.postStateToWebview()
	}

	/** Build task-local ports used by the mode-switch transaction. */
	private createModeSwitchCoordinator(): ModeSwitchCoordinator {
		return new ModeSwitchCoordinator({
			profiles: {
				getSource: () => (this.task ? this.resolveModeProfile(this.task.getMode()) : undefined),
				resolve: (mode) => this.resolveModeProfile(mode),
			},
			pressure: { read: () => this.readModeSwitchPressure() },
			compaction: {
				compact: (operationId) => this.task?.compactForMode(operationId) ?? Promise.resolve("failed"),
				release: (operationId) => this.task?.releaseCompact(operationId),
				fail: (operationId, reason) => this.task?.failCompact(operationId, reason),
			},
			commit: {
				validate: (operation) => this.validateModeSwitch(operation),
				commit: async (operation) => {
					if (!this.task) throw new Error("Active task is unavailable.")
					await this.task.commitMode(operation.target.mode, operation.chatContent)
					telemetryService.captureModeSwitch(this.task.ulid, operation.target.mode)
					await this.postStateToWebview({ immediate: true })
				},
			},
			postState: () => this.postStateToWebview({ immediate: true }),
			createId: () => crypto.randomUUID(),
			getTaskId: () => this.task?.taskId,
		})
	}

	/** Resolve effective profile metadata for one task-local mode. */
	private resolveModeProfile(mode: Mode): ResolvedModeProfile | undefined {
		if (!this.task) return undefined
		const config = this.stateManager.getApiConfiguration()
		const profileName =
			mode === "plan"
				? (this.task.taskSm.planModeProfile ?? config.planModeProfile)
				: (this.task.taskSm.actModeProfile ?? config.actModeProfile)
		const profile = findEnabledProfileByName(profileName)
		const contextWindow = profile ? getProfileModelInfo(profile).capabilities?.contextWindow : undefined
		return profileName && contextWindow ? { mode, profile: profileName, contextWindow } : undefined
	}

	/** Read canonical pressure from the latest completed API request. */
	private readModeSwitchPressure(): number {
		const messages = this.task?.messageStateHandler.clineMessages ?? []
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index]
			if (message.say === "api_req_started") {
				const tokens = readContextTokens(message.text)
				if (tokens > 0) return tokens
			}
		}
		return 0
	}

	/** Validate task, source mode, and source profile immediately before compaction or commit. */
	private validateModeSwitch(operation: ModeSwitchOperation): boolean {
		const source = this.task ? this.resolveModeProfile(this.task.getMode()) : undefined
		return Boolean(
			this.task?.taskId === operation.taskId &&
				source?.mode === operation.source.mode &&
				source.profile === operation.source.profile &&
				source.contextWindow === operation.source.contextWindow,
		)
	}

	/** Request a task-local transaction or update the welcome-screen global mode. */
	async requestModeSwitch(targetMode: Mode, chatContent?: ChatContent): Promise<ModeSwitchRequestResult> {
		if (!this.task) {
			this.stateManager.setGlobalState("mode", targetMode)
			await this.postStateToWebview({ immediate: true })
			return { status: "switched", operationId: crypto.randomUUID() }
		}
		return this.modeSwitchCoordinator.request({ taskId: this.task.taskId, targetMode, chatContent })
	}

	/** Confirm the active mode-switch compaction transaction. */
	async confirmModeSwitch(operationId: string): Promise<ModeSwitchRequestResult> {
		return this.modeSwitchCoordinator.confirm(operationId)
	}

	/** Cancel the active mode-switch confirmation transaction. */
	async cancelModeSwitch(operationId: string): Promise<ModeSwitchRequestResult> {
		return this.modeSwitchCoordinator.cancel(operationId)
	}

	/** Compatibility wrapper for internal callers that still consume a Boolean commit result. */
	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		const result = await this.requestModeSwitch(modeToSwitchTo, chatContent)
		return result.status === "switched"
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		if (!this.task) return false
		await this.task.commitMode("act")
		telemetryService.captureModeSwitch(this.task.ulid, "act")
		await this.postStateToWebview({ immediate: true })
		return true
	}

	async cancelTask() {
		if (this.cancelInProgress || !this.task) {
			return
		}
		this.cancelInProgress = true
		try {
			this.updateBackgroundCommandState(false)
			const result = await this.task.requestCancellation()
			if (!result.accepted) {
				Logger.warn(`Controller.cancelTask: runtime rejected cancellation (${result.error?.code ?? "unknown"})`)
			}
		} finally {
			this.cancelInProgress = false
		}
	}

	updateBackgroundCommandState(running: boolean, taskId?: string) {
		const nextTaskId = running ? taskId : undefined
		if (this.backgroundCommandRunning === running && this.backgroundCommandTaskId === nextTaskId) {
			return
		}
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = nextTaskId
		void this.postStateToWebview()
	}

	/**
	 * Persists the panel state to the webview so VSCode can restore it on next window reload.
	 * State is saved via acquireVsCodeApi().setState() inside the webview.
	 *
	 * @param taskId - The task ID to persist
	 */
	private async persistPanelStateIfNeeded(taskId: string): Promise<void> {
		try {
			const { WebviewProviderRegistry } = await import("@/core/webview/WebviewProviderRegistry")
			const { VscodeWebviewPanelProvider } = await import("@/hosts/vscode/VscodeWebviewPanelProvider")
			const panels = WebviewProviderRegistry.getPanels()
			for (const provider of panels) {
				if (provider instanceof VscodeWebviewPanelProvider && provider.hasController() && provider.controller === this) {
					provider.setPendingTaskId(taskId)
					break
				}
			}
		} catch {
			// Non-critical; panel may not be available (e.g. sidebar controller)
		}
	}

	private async clearPanelStateIfNeeded(): Promise<void> {
		try {
			const { WebviewProviderRegistry } = await import("@/core/webview/WebviewProviderRegistry")
			const { VscodeWebviewPanelProvider } = await import("@/hosts/vscode/VscodeWebviewPanelProvider")
			const panels = WebviewProviderRegistry.getPanels()
			for (const provider of panels) {
				if (provider instanceof VscodeWebviewPanelProvider && provider.hasController() && provider.controller === this) {
					await provider.clearPanelState()
					break
				}
			}
		} catch {
			// Non-critical
		}
	}

	/**
	 * Syncs the editor tab title for the panel hosting this controller's task.
	 * Called when task description or focus chain progress changes.
	 *
	 * @param title - New title text (will be truncated to 16 chars)
	 */
	async syncPanelTitle(title: string): Promise<void> {
		if (!this.task) {
			return
		}
		try {
			const { WebviewProviderRegistry } = await import("@/core/webview/WebviewProviderRegistry")
			const { VscodeWebviewPanelProvider } = await import("@/hosts/vscode/VscodeWebviewPanelProvider")
			const panels = WebviewProviderRegistry.getPanels()
			for (const provider of panels) {
				if (provider instanceof VscodeWebviewPanelProvider && provider.hasController() && provider.controller === this) {
					provider.updateTitle(title)
					Logger.debug(`[Controller] Panel title synced: ${title}`)
					break
				}
			}
		} catch (error) {
			Logger.warn(`[Controller] Failed to sync panel title:`, error)
		}
	}

	async cancelBackgroundCommand(): Promise<void> {
		const didCancel = await this.task?.cancelBackgroundCommand()
		if (!didCancel) {
			this.updateBackgroundCommandState(false)
		}
	}

	async handleAuthCallback(customToken: string, provider: string | null = null) {
		try {
			await this.authService.handleAuthCallback(customToken, provider ? provider : "google")

			const currentMode = this.stateManager.getGlobalSettingsKey("mode")
			const currentApiConfiguration = this.stateManager.getApiConfiguration()

			// Mark welcome view as completed since user has successfully logged in
			this.stateManager.setGlobalState("welcomeViewCompleted", true)

			await fetchRemoteConfig(this)

			if (this.task) {
				const activeProfile =
					currentMode === "plan" ? currentApiConfiguration.planModeProfile : currentApiConfiguration.actModeProfile
				if (activeProfile) {
					this.task.api = buildApiHandler({ ...currentApiConfiguration, ulid: this.task.ulid }, currentMode)
				}
			}

			await this.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to handle auth callback:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to log in to Cline",
			})
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	async handleOcaAuthCallback(code: string, state: string) {
		try {
			await this.ocaAuthService.handleAuthCallback(code, state)

			const currentMode = this.stateManager.getGlobalSettingsKey("mode")
			const currentApiConfiguration = this.stateManager.getApiConfiguration()

			// Mark welcome view as completed since user has successfully logged in
			this.stateManager.setGlobalState("welcomeViewCompleted", true)

			if (this.task) {
				const activeProfile =
					currentMode === "plan" ? currentApiConfiguration.planModeProfile : currentApiConfiguration.actModeProfile
				if (activeProfile) {
					this.task.api = buildApiHandler({ ...currentApiConfiguration, ulid: this.task.ulid }, currentMode)
				}
			}

			await this.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to handle auth callback:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to log in to OCA",
			})
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	async handleMcpOAuthCallback(serverHash: string, code: string, state: string | null) {
		try {
			await this.mcpHub.completeOAuth(serverHash, code, state)
			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Successfully authenticated MCP server`,
			})
		} catch (error) {
			Logger.error("Failed to complete MCP OAuth:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to authenticate MCP server`,
			})
		}
	}

	async handleTaskCreation(prompt: string) {
		await sendChatButtonClickedEvent(this)
		await this.initTask(prompt)
	}

	// MCP Marketplace
	private async fetchMcpMarketplaceFromApi(): Promise<McpMarketplaceCatalog> {
		const response = await axios.get(`${ClineEnv.config()?.mcpBaseUrl ?? ""}/marketplace`, {
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "cline-vscode-extension",
			},
			...getAxiosSettings(),
		})

		if (!response.data) {
			throw new Error("Invalid response from MCP marketplace API")
		}

		// Get allowlist from remote config
		const allowedMCPServers = this.stateManager.getRemoteConfigSettings().allowedMCPServers

		let items: McpMarketplaceItem[] = (response.data || []).map((item: McpMarketplaceItem) => ({
			...item,
			githubStars: item.githubStars ?? 0,
			downloadCount: item.downloadCount ?? 0,
			tags: item.tags ?? [],
		}))

		// Filter by allowlist if configured
		if (allowedMCPServers) {
			const allowedIds = new Set(allowedMCPServers.map((server) => server.id))
			items = items.filter((item: McpMarketplaceItem) => allowedIds.has(item.mcpId))
		}

		const catalog: McpMarketplaceCatalog = { items }

		// Store in cache file
		await writeMcpMarketplaceCatalogToCache(catalog)
		return catalog
	}

	async refreshMcpMarketplace(sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi()
			if (catalog && sendCatalogEvent) {
				await sendMcpMarketplaceCatalogEvent(this, catalog)
			}
			return catalog
		} catch (error) {
			Logger.error("Failed to refresh MCP marketplace:", error)
			return undefined
		}
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://openrouter.ai/api/v1/auth/keys", { code }, getAxiosSettings())
			if (response.data?.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			Logger.error("Error exchanging code for API key:", error)
			throw error
		}

		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		const currentApiConfiguration = this.stateManager.getApiConfiguration()

		const orProfiles = findEnabledProfiles("openrouter")
		if (orProfiles.length > 0) {
			for (const p of orProfiles) {
				SecretsManager.setApiKey(p.id, apiKey, p.name)
			}
		}

		await this.postStateToWebview()
		if (this.task) {
			const activeProfile =
				currentMode === "plan" ? currentApiConfiguration.planModeProfile : currentApiConfiguration.actModeProfile
			if (activeProfile) {
				this.task.api = buildApiHandler({ ...currentApiConfiguration, ulid: this.task.ulid }, currentMode)
			}
		}
		// Dont send settingsButtonClicked because its bad ux if user is on welcome
	}

	// Requesty

	async handleRequestyCallback(code: string) {
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		const currentApiConfiguration = this.stateManager.getApiConfiguration()

		const requestyProfiles = findEnabledProfiles("requesty")
		for (const p of requestyProfiles) {
			SecretsManager.setApiKey(p.id, code, p.name)
		}

		await this.postStateToWebview()
		if (this.task) {
			const activeProfile =
				currentMode === "plan" ? currentApiConfiguration.planModeProfile : currentApiConfiguration.actModeProfile
			if (activeProfile) {
				this.task.api = buildApiHandler({ ...currentApiConfiguration, ulid: this.task.ulid }, currentMode)
			}
		}
	}

	// Read OpenRouter models from disk cache
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.openRouterModels)
		try {
			if (await fileExistsAtPath(openRouterModelsFilePath)) {
				const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
				const models = JSON.parse(fileContents)
				// Append stealth models
				return appendClineStealthModels(models)
			}
		} catch (error) {
			Logger.error("Error reading cached OpenRouter models:", error)
		}
		return undefined
	}

	// Hicap
	async handleHicapCallback(code: string) {
		const apiKey: string = code

		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		const currentApiConfiguration = this.stateManager.getApiConfiguration()

		const hcProfiles = findEnabledProfiles("hicap")
		if (hcProfiles.length > 0) {
			for (const p of hcProfiles) {
				SecretsManager.setApiKey(p.id, apiKey, p.name)
			}
		}

		await this.postStateToWebview()
		this.accountService
		if (this.task) {
			const activeProfile =
				currentMode === "plan" ? currentApiConfiguration.planModeProfile : currentApiConfiguration.actModeProfile
			if (activeProfile) {
				this.task.api = buildApiHandler({ ...currentApiConfiguration, ulid: this.task.ulid }, currentMode)
			}
		}
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = this.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(await getDlineDocumentsPath(), "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = await readJsonl<Anthropic.MessageParam>(apiConversationHistoryFilePath)
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesn't save to disk for some reason
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async exportTaskWithId(id: string) {
		const { taskDirPath } = await this.getTaskWithId(id)
		Logger.log(`[EXPORT] Opening task directory: ${taskDirPath}`)
		await open(taskDirPath)
	}

	async deleteTaskFromState(id: string) {
		// Persist deletion via TaskHistory instance (cross-process safe via transact + FileLock)
		await this.stateManager.taskHistory.softDelete(id)

		// Remove from in-memory cache
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
		this.stateManager.setGlobalState("taskHistory", updatedTaskHistory)

		// Release file ownership in the global checkpoint registry
		const { WorkspaceFileRegistry } = await import("@integrations/checkpoints/WorkspaceFileRegistry")
		WorkspaceFileRegistry.getInstance().releaseTask(id)

		// Notify the webview that the task has been deleted
		await this.postStateToWebview()

		return updatedTaskHistory
	}

	/** Build and publish the latest non-stale extension state. */
	async postStateToWebview(options?: PostStateOptions): Promise<void> {
		const state = await this.getStateToPostToWebview()
		if (!this.isStateCurrent(state.stateRevision)) return
		await sendStateUpdate(this, state, this._accountUsage, options)
	}

	/** Build a monotonic extension state while preserving the public non-optional contract. */
	async getStateToPostToWebview(): Promise<ExtensionState> {
		const revision = ++this.nextStateRevision
		const state = await this.buildState(revision)
		if (revision > this.latestStateRevision) {
			this.latestStateRevision = revision
		}
		return state
	}

	/** Report whether a completed asynchronous state build is still current. */
	isStateCurrent(revision: number): boolean {
		return revision >= this.latestStateRevision
	}

	/** Build one extension-state snapshot for a preallocated revision. */
	protected async buildState(revision: number): Promise<ExtensionState> {
		const startTime = performance.now()
		// Ensure per-task settings isolation: set active task before reading
		// any settings that depend on task-level overrides (apiConfiguration, mode, etc.).
		if (this.task?.taskId) {
			this.stateManager.setActiveTaskId(this.task.taskId)
		} else {
			this.stateManager.setActiveTaskId(undefined)
		}
		// Get API configuration from cache — must be AFTER setActiveTaskId
		// so that getSettingWithOverride() can read task-level profile overrides.
		const onboardingModels = getClineOnboardingModels()
		let apiConfiguration = this.stateManager.getApiConfiguration()

		// Override with task-level profile settings if available (multi-window isolation fix)
		if (this.task?.taskSm) {
			const taskPlanProfile = this.task.taskSm.planModeProfile
			const taskActProfile = this.task.taskSm.actModeProfile
			if (taskPlanProfile !== undefined || taskActProfile !== undefined) {
				apiConfiguration = {
					...apiConfiguration,
					...(taskPlanProfile !== undefined && { planModeProfile: taskPlanProfile }),
					...(taskActProfile !== undefined && { actModeProfile: taskActProfile }),
				}
			}
		}
		const lastShownAnnouncementId = this.stateManager.getGlobalStateKey("lastShownAnnouncementId")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		const preferredLanguage = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		const mode = this.task?.taskSm?.mode ?? this.stateManager.getGlobalSettingsKey("mode")
		const strictPlanModeEnabled = this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled")
		const yoloModeToggled = this.stateManager.getGlobalSettingsKey("yoloModeToggled")
		const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")
		const subagentsEnabled = this.stateManager.getGlobalSettingsKey("subagentsEnabled")
		const userInfo = this.stateManager.getGlobalStateKey("userInfo")
		const mcpMarketplaceEnabled = this.stateManager.getGlobalStateKey("mcpMarketplaceEnabled")
		const mcpDisplayMode = this.stateManager.getGlobalStateKey("mcpDisplayMode")
		const telemetrySetting = this.stateManager.getGlobalSettingsKey("telemetrySetting")
		const planActSeparateModelsSetting = this.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
		const enableCheckpointsSetting = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
		const globalClineRulesToggles = this.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
		const globalWorkflowToggles = this.stateManager.getGlobalSettingsKey("globalWorkflowToggles")
		const globalSkillsToggles = this.stateManager.getGlobalSettingsKey("globalSkillsToggles")
		const localSkillsToggles = this.stateManager.getWorkspaceStateKey("localSkillsToggles")
		const remoteRulesToggles = this.stateManager.getGlobalStateKey("remoteRulesToggles")
		const remoteWorkflowToggles = this.stateManager.getGlobalStateKey("remoteWorkflowToggles")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		// Can be undefined but is set to either true or false by the migration that runs on extension launch in extension.ts
		const welcomeViewCompleted = !!this.stateManager.getGlobalStateKey("welcomeViewCompleted")

		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		const mcpResponsesCollapsed = this.stateManager.getGlobalStateKey("mcpResponsesCollapsed")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const maxConsecutiveMistakes = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const favoritedModelIds = this.stateManager.getGlobalStateKey("favoritedModelIds")
		const doubleCheckCompletionEnabled = this.stateManager.getGlobalSettingsKey("doubleCheckCompletionEnabled")
		const lazyTeammateModeEnabled = this.stateManager.getGlobalSettingsKey("lazyTeammateModeEnabled")
		const showFeatureTips = this.stateManager.getGlobalSettingsKey("showFeatureTips")
		const showActiveTasksInEnvDetails = this.stateManager.getGlobalSettingsKey("showActiveTasksInEnvDetails")

		const localClineRulesToggles = this.stateManager.getWorkspaceStateKey("localClineRulesToggles")
		const localWindsurfRulesToggles = this.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
		const localCursorRulesToggles = this.stateManager.getWorkspaceStateKey("localCursorRulesToggles")
		const localAgentsRulesToggles = this.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
		const workflowToggles = this.stateManager.getWorkspaceStateKey("workflowToggles")

		const currentTaskItem = this.task?.taskId ? (taskHistory || []).find((item) => item.id === this.task?.taskId) : undefined
		const rawMessages = [...(this.task?.messageStateHandler.clineMessages || [])]
		// Separate task header message from body messages.
		const _taskHeaderText = this.task?.taskId
			? await getTaskHeaderText(this.task.taskId)
			: (rawMessages.find((m) => m.say === "task")?.text ?? rawMessages.at(0)?.text ?? "")
		// Build a synthetic taskTitleMessage for backward compatibility with frontend
		const taskTitleMessage = rawMessages.find((m) => m.say === "task") ?? rawMessages.at(0)
		// totalMessageCount now includes the task message (matching fetchMessage behavior)
		// so the frontend can detect when scrolled to the absolute top (index 0)
		const totalMessageCount = rawMessages.length
		// firstItemIndex is managed by fetchMessage; default to latest window on init
		const firstItemIndex = Math.max(0, totalMessageCount - 100)
		const checkpointManagerErrorMessage = this.task?.taskState.checkpointManagerErrorMessage
		const processedTaskHistory = (taskHistory || [])
			.filter((item) => item.ts && item.task)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, 100) // for now we're only getting the latest 100 tasks, but a better solution here is to only pass in 3 for recent task history, and then get the full task history on demand when going to the task history view (maybe with pagination?)

		const latestAnnouncementId = getLatestAnnouncementId()
		const shouldShowAnnouncement = lastShownAnnouncementId !== latestAnnouncementId
		const platform = process.platform as Platform
		const distinctId = getDistinctId()
		const version = ExtensionRegistryInfo.version
		const clineConfig = ClineEnv.config()
		const environment = clineConfig?.environment
		// Check OpenAI Codex authentication status
		const { openAiCodexOAuthManager } = await import("@/integrations/openai-codex/oauth")
		const openAiCodexIsAuthenticated = await openAiCodexOAuthManager.isAuthenticated()

		// Compute apiMetrics from all messages (not window slice).
		// These are passed through subscribeToState so the frontend
		// renders task header stats without depending on clineMessages.
		const allMessages = this.task?.messageStateHandler.clineMessages || []
		let metricMessages = allMessages
		try {
			metricMessages = combineApiRequests(combineCommandSequences(allMessages))
		} catch (error) {
			Logger.warn("Failed to combine messages for api metrics:", error)
		}
		const { getApiMetrics, getLastApiReqTotalTokens, getLastTaskProgressText } = await import("@shared/getApiMetrics")
		const apiMetrics = getApiMetrics(metricMessages)
		const lastApiReqTotalTokens = getLastApiReqTotalTokens(metricMessages)

		// If currentFocusChainChecklist is null, fall back to searching
		// the full message list (not the window slice) for task_progress.
		const checklistFromTaskState = this.task?.taskState.currentFocusChainChecklist || null
		const checklistForState = checklistFromTaskState || getLastTaskProgressText(allMessages)

		const result: ExtensionState = {
			stateRevision: revision,
			modeSwitch: this.modeSwitchCoordinator.getSnapshot(),
			version,
			apiConfiguration,
			currentTaskItem,
			taskTitleMessage,
			totalMessageCount,
			firstItemIndex,
			apiMetrics,
			lastApiReqTotalTokens,
			currentFocusChainChecklist: checklistForState,
			focusChainHistory: this.task?.taskState.focusChainHistory || null,
			checkpointManagerErrorMessage,
			autoApprovalSettings,
			browserSettings,
			focusChainSettings,
			preferredLanguage,
			mode,
			strictPlanModeEnabled,
			yoloModeToggled,
			useAutoCondense,
			subagentsEnabled,
			userInfo,
			mcpMarketplaceEnabled,
			mcpDisplayMode,
			telemetrySetting,
			planActSeparateModelsSetting,
			enableCheckpointsSetting: enableCheckpointsSetting ?? true,
			platform,
			environment,
			distinctId,
			globalClineRulesToggles: globalClineRulesToggles || {},
			localClineRulesToggles: localClineRulesToggles || {},
			localWindsurfRulesToggles: localWindsurfRulesToggles || {},
			localCursorRulesToggles: localCursorRulesToggles || {},
			localAgentsRulesToggles: localAgentsRulesToggles || {},
			localWorkflowToggles: workflowToggles || {},
			globalWorkflowToggles: globalWorkflowToggles || {},
			globalSkillsToggles: globalSkillsToggles || {},
			localSkillsToggles: localSkillsToggles || {},
			remoteRulesToggles: remoteRulesToggles,
			remoteWorkflowToggles: remoteWorkflowToggles,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			vscodeTerminalExecutionMode: vscodeTerminalExecutionMode,
			defaultTerminalProfile,
			isNewUser,
			welcomeViewCompleted,
			onboardingModels,
			mcpResponsesCollapsed,
			terminalOutputLineLimit,
			maxConsecutiveMistakes,
			customPrompt,
			taskHistory: processedTaskHistory,
			shouldShowAnnouncement,
			favoritedModelIds,
			providersVersion: ModelRegistry.getInstance().version,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			// NEW: Add workspace information
			workspaceRoots: this.workspaceManager?.getRoots() ?? [],
			primaryRootIndex: this.workspaceManager?.getPrimaryIndex() ?? 0,
			isMultiRootWorkspace: (this.workspaceManager?.getRoots().length ?? 0) > 1,
			multiRootSetting: {
				user: this.stateManager.getGlobalStateKey("multiRootEnabled"),
				featureFlag: true, // Multi-root workspace is now always enabled
			},
			clineWebToolsEnabled: {
				user: this.stateManager.getGlobalSettingsKey("clineWebToolsEnabled"),
				featureFlag: featureFlagsService.getWebtoolsEnabled(),
			},
			worktreesEnabled: {
				user: this.stateManager.getGlobalSettingsKey("worktreesEnabled"),
				featureFlag: featureFlagsService.getWorktreesEnabled(),
			},
			hooksEnabled: getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled")),
			remoteConfigSettings: this.stateManager.getRemoteConfigSettings(),
			nativeToolCallSetting: this.stateManager.getGlobalStateKey("nativeToolCallEnabled"),
			enableParallelToolCalling: this.stateManager.getGlobalSettingsKey("enableParallelToolCalling"),
			backgroundEditEnabled: this.stateManager.getGlobalSettingsKey("backgroundEditEnabled"),
			optOutOfRemoteConfig: this.stateManager.getGlobalSettingsKey("optOutOfRemoteConfig"),
			doubleCheckCompletionEnabled,
			lazyTeammateModeEnabled,
			showFeatureTips,
			showActiveTasksInEnvDetails,
			openAiCodexIsAuthenticated,
			/** Task lock status — computed on each state push so the frontend
			 *  can show a lock banner when the task is in read-only mode. */
			taskLockStatus: this.getTaskLockStatus(),
			/** Complete interaction view projected only from canonical runtime state. */
			taskViewState: this.task ? projectTaskView(this.task.getRuntimeState()) : undefined,
		}

		const durationMs = Math.round(performance.now() - startTime)
		if (durationMs > 10) {
			Logger.debug(`[Controller] getStateToPostToWebview took ${durationMs}ms for task ${this.task?.taskId}`)
		}
		return result
	}

	/** Poll account usage every 60 seconds and push to webview */
	private startAccountUsagePolling() {
		// Idempotent: skip if polling is already active to prevent timer
		// leaks when multiple windows / tasks call this repeatedly.
		if (this.accountUsageTimer) {
			return
		}
		const generation = ++this.accountUsagePollGeneration
		const clearStaleUsage = async () => {
			if (generation !== this.accountUsagePollGeneration || !this._accountUsage) {
				return
			}
			this._accountUsage = undefined
			await this.postStateToWebview()
		}
		const poll = async () => {
			try {
				const apiConfig = this.stateManager.getApiConfiguration()
				const mode = this.stateManager.getGlobalSettingsKey("mode") || "act"
				const handler = buildApiHandler(apiConfig, mode)
				if (!handler.getAccountUsage) {
					await clearStaleUsage()
					return
				}
				const usage = await handler.getAccountUsage()
				if (generation !== this.accountUsagePollGeneration) {
					return
				}
				if (!usage) {
					await clearStaleUsage()
					return
				}
				this._accountUsage = usage
				Logger.debug("[UsagePoll] accountUsage updated")
				await this.postStateToWebview()
			} catch (e) {
				await clearStaleUsage()
				Logger.warn(`[UsagePoll] Failed: ${e}`)
			}
		}
		poll() // immediate first call
		this.accountUsageTimer = setInterval(poll, 60_000)
	}

	private stopAccountUsagePolling() {
		this.accountUsagePollGeneration++
		if (this.accountUsageTimer) {
			clearInterval(this.accountUsageTimer)
			this.accountUsageTimer = undefined
		}
	}

	/** Restart account usage polling with current profile. Called after profile switch. */
	public restartAccountUsagePolling() {
		this.stopAccountUsagePolling()
		this.startAccountUsagePolling()
	}

	/**
	 * Starts polling for lock availability when the current task is in
	 * read-only mode (locked by another instance). When the lock becomes
	 * available, automatically acquires it and activates the task.
	 *
	 * @param taskId The task ID to poll for
	 */
	private startLockPoll(taskId: string) {
		this.stopLockPoll()
		this.lockPollTimer = setInterval(async () => {
			try {
				const status = await this.lockService.checkTaskLock(taskId)
				if (!status.isLocked || status.isStale) {
					// Lock is now available — acquire and activate the task
					const acquired = await this.lockService.acquireTaskLock(taskId)
					if (acquired) {
						Logger.debug(`[Lock] Auto-acquired lock for task ${taskId} after polling`)
						this.taskLockAcquired = true
						this.stopLockPoll()
						// Start heartbeat to keep lock fresh
						this.lockHeartbeatTimer = setInterval(() => {
							this.lockService.touchTaskLock(taskId).catch(() => {})
						}, 60000)
						// Activate the task from read-only to interactive mode
						if (this.task) {
							await this.task.resumeFromHistory()
						}
						await this.postStateToWebview()
					}
				}
			} catch (error) {
				Logger.warn(`[Lock] Poll error for task ${taskId}:`, error)
			}
		}, 30000) // Poll every 30 seconds
	}

	/**
	 * Stops the lock polling timer.
	 */
	private stopLockPoll() {
		if (this.lockPollTimer) {
			clearInterval(this.lockPollTimer)
			this.lockPollTimer = undefined
		}
	}

	/**
	 * Activate the task after force-unlocking from another instance.
	 * Transitions the task from read-only mode to full interactive mode,
	 * starts the lock heartbeat, and pushes updated state to the webview.
	 *
	 * @param taskId The task ID that was unlocked
	 */
	async activateTaskAfterUnlock(taskId: string) {
		this.taskLockAcquired = true
		this.stopLockPoll()

		// Start lock heartbeat to keep the new lock fresh
		this.lockHeartbeatTimer = setInterval(() => {
			this.lockService.touchTaskLock(taskId).catch(() => {})
		}, 60000)

		// Activate the task from read-only to interactive mode
		if (this.task) {
			try {
				await this.task.resumeFromHistory()
			} catch (error) {
				Logger.error(`[Lock] Failed to resume task ${taskId} after unlock:`, error)
			}
		}

		// Notify webview so the read-only banner is removed
		await this.postStateToWebview()
		Logger.debug(`[Lock] Task ${taskId} activated after force-unlock`)
	}

	/**
	 * Computes the current task lock status for the frontend.
	 * Returns undefined when the lock is acquired (normal operation)
	 * or when there is no active task.
	 *
	 * @returns TaskLockStatus if in read-only mode, undefined otherwise
	 */
	private getTaskLockStatus(): TaskLockStatus | undefined {
		if (!this.task?.taskId) {
			return undefined
		}
		// When lock is acquired, no banner needed
		if (this.taskLockAcquired) {
			return undefined
		}
		// Task is in read-only mode — return a placeholder status.
		// The actual lock details are checked asynchronously via the
		// checkTaskLock RPC when the frontend first renders the banner.
		return {
			isLocked: true,
			lockedBy: "",
			lockedAt: 0,
			isStale: false,
		} as TaskLockStatus
	}

	async clearTask(options?: { clearPanelState?: boolean }) {
		// Stop lock heartbeat
		if (this.lockHeartbeatTimer) {
			clearInterval(this.lockHeartbeatTimer)
			this.lockHeartbeatTimer = undefined
		}
		// Stop lock polling
		this.stopLockPoll()
		this.taskLockAcquired = false
		const taskId = this.task?.taskId
		if (taskId && options?.clearPanelState) {
			await this.clearPanelStateIfNeeded()
		}
		await this.modeSwitchCoordinator.reset("Task cleared during mode switch.")
		if (this.task) {
			// Sync task mode to global state so slider works after task closed
			this.stateManager.setGlobalState("mode", this.task.taskSm.mode)
			// Clear task settings cache when task ends
			await this.stateManager.clearTaskSettings()
		}
		await this.task?.terminate()
		// Release file lock so other instances can open the task
		if (taskId) {
			await this.lockService.releaseTaskLock(taskId).catch((e) => Logger.error("Failed to release lock:", e))
		}
		this.task = undefined // removes reference to it, so once promises end it will be garbage collected
		// Release file ownership in the global checkpoint registry
		if (taskId) {
			const { WorkspaceFileRegistry } = await import("@integrations/checkpoints/WorkspaceFileRegistry")
			WorkspaceFileRegistry.getInstance().releaseTask(taskId)
		}
		await this.postStateToWebview()
	}

	// Caching mechanism to keep track of webview messages + API conversation history per provider instance

	/*
	Now that we use retainContextWhenHidden, we don't have to store a cache of cline messages in the user's state, but we could to reduce memory footprint in long conversations.

	- We have to be careful of what state is shared between ClineProvider instances since there could be multiple instances of the extension running at once. For example when we cached cline messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
	- Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notify the other instances that the API key has changed.

	We need to use a unique identifier for each ClineProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

	// conversation history to send in API requests

	/*
	It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way that's creating cyclic references, or the API returns a function or a Symbol as part of the message content.
	VSCode docs about state: "The value must be JSON-stringifyable ... value �?A value. MUST not contain cyclic references."
	For now we'll store the conversation history in memory, and if we need to store in state directly we'd need to do a manual conversion to ensure proper json stringification.
	*/

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		// Persist to disk via TaskHistory instance (memory-level + 10s flush timer).
		await this.stateManager.taskHistory.upsertTaskHistory(item)

		// Update in-memory cache for immediate UI rendering
		const history = [...(this.stateManager.getGlobalStateKey("taskHistory") ?? [])]
		const existingItemIndex = history.findIndex((h) => h.id === item.id)
		if (existingItemIndex !== -1) {
			history[existingItemIndex] = item
		} else {
			history.push(item)
		}
		this.stateManager.setGlobalState("taskHistory", history)
		return history
	}
}
