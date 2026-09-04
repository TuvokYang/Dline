import { WebviewProvider } from "./core/webview"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"
import { FileContextTracker } from "./core/context/context-tracking/FileContextTracker"
import { flushAllWorkspaceHistoryManagers } from "./core/controller/history/WorkspaceHistoryManager"
import { clearOnboardingModelsCache } from "./core/controller/models/getClineOnboardingModels"
import { HookDiscoveryCache } from "./core/hooks/HookDiscoveryCache"
import { HookProcessRegistry } from "./core/hooks/HookProcessRegistry"
import { ModelRegistry } from "./core/model-registry/ModelRegistry"
import { ensureSeedProviders } from "./core/model-registry/seed-initializer"
import { StateManager } from "./core/storage/StateManager"
import { AgentConfigLoader } from "./core/task/tools/subagent/AgentConfigLoader"
import { ExtensionRegistryInfo } from "./registry"
import { ErrorService } from "./services/error"
import { featureFlagsService } from "./services/feature-flags"
import { getDistinctId } from "./services/logging/distinctId"
import { DlineRuntimeFileManager } from "./services/runtime-files"
import { telemetryService } from "./services/telemetry"
import { PostHogClientProvider } from "./services/telemetry/providers/posthog/PostHogClientProvider"
import { cleanupTestMode } from "./services/test/TestMode"
import { ShowMessageType } from "./shared/proto/dline/host/window"
import { syncWorker } from "./shared/services/worker/sync"
import { getBlobStoreSettingsFromEnv } from "./shared/services/worker/worker"
import { getLatestAnnouncementId } from "./utils/announcements"
import { arePathsEqual } from "./utils/path"

/**
 * Performs intialization for Cline that is common to all platforms.
 *
 * @param context
 * @returns The webview provider
 * @throws ClineConfigurationError if endpoints.json exists but is invalid
 */
export async function initialize(storageContext: StorageContext): Promise<WebviewProvider> {
	const initStart = performance.now()
	Logger.debug("[Dline] common.initialize: start")
	// Configure the shared Logging class to use HostProvider's output channels and debug logger
	Logger.debug(`[Dline] common.initialize: Logger configured +${Math.round(performance.now() - initStart)}ms`)
	Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg)) // File system logging
	Logger.subscribe((msg: string) => {
		HostProvider.env.debugLog({ value: msg }).catch((err: unknown) => {
			// biome-ignore lint/plugin: intentional — must not use Logger to avoid recursion
			console.error("[Dline] debugLog failed:", err)
		})
	})

	// Prime cachedDocumentsPath so synchronous consumers (getDlineDocumentsPathSync)
	// use the correct system Documents directory. Must run before StateManager.init
	// which calls AgentConfigLoader.getInstance → getDlineDocumentsPathSync.
	const { warmupDocumentsPathCache } = await import("./core/storage/disk")
	await warmupDocumentsPathCache()

	// Initialize ClineEndpoint configuration (reads bundled and ~/.cline/endpoints.json if present)
	// This must be done before any other code that calls ClineEnv.config()
	// Throws ClineConfigurationError if config file exists but is invalid
	const { ClineEndpoint } = await import("./config")
	Logger.debug(`[Dline] common.initialize: before ClineEndpoint +${Math.round(performance.now() - initStart)}ms`)
	await ClineEndpoint.initialize(HostProvider.get().extensionFsPath)
	Logger.debug(`[Dline] common.initialize: after ClineEndpoint +${Math.round(performance.now() - initStart)}ms`)

	try {
		Logger.debug(`[Dline] common.initialize: before StateManager +${Math.round(performance.now() - initStart)}ms`)
		await StateManager.initialize(storageContext)
		Logger.debug(`[Dline] common.initialize: after StateManager +${Math.round(performance.now() - initStart)}ms`)
	} catch (error) {
		Logger.error("[Dline] CRITICAL: Failed to initialize StateManager:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to initialize storage. Please check logs for details or try restarting the client.",
		})
		const webview = HostProvider.get().createWebviewProvider()
		webview.setStartupFailure(error)
		return webview
	}

	// =============== Model Registry ===============
	// Ensure seed provider configs exist and initialize the model registry
	try {
		const registry = ModelRegistry.getInstance()
		await ensureSeedProviders(registry.providersDir)
		await registry.initialize()
	} catch (error) {
		Logger.error("[Dline] Failed to initialize ModelRegistry:", error)
	}

	// =============== External services ===============
	await ErrorService.initialize()
	// PostHog client provider disabled - no telemetry data upload

	// =============== Webview services ===============
	Logger.debug(`[Dline] common.initialize: before createWebview +${Math.round(performance.now() - initStart)}ms`)
	const webview = HostProvider.get().createWebviewProvider()
	webview.ensureController()

	// Initialize OrchestratorController and register sidebar as main controller
	const { OrchestratorController } = await import("./core/orchestrator/OrchestratorController")
	OrchestratorController.initialize().registerMainController(webview.controller)

	// Register ModelRegistry fs-watch → webview state push
	ModelRegistry.getInstance().onChange(() => {
		webview.controller?.postStateToWebview()
	})

	Logger.debug(`[Dline] common.initialize: after ensureController +${Math.round(performance.now() - initStart)}ms`)

	const stateManager = StateManager.get()
	// Non-blocking announcement check and display
	showVersionUpdateAnnouncement(stateManager)
	// Check if this workspace was opened from worktree quick launch
	await checkWorktreeAutoOpen(stateManager)

	// =============== Background sync and cleanup tasks ===============
	// Use remote config blobStoreConfig if available, otherwise fall back to env vars
	const blobStoreSettings = stateManager.getRemoteConfigSettings()?.blobStoreConfig ?? getBlobStoreSettingsFromEnv()
	syncWorker().init({ ...blobStoreSettings, userDistinctId: getDistinctId() })
	// Clean up old temp files in background (non-blocking) and start periodic cleanup every 24 hours
	DlineRuntimeFileManager.startPeriodicCleanup()
	// Clean up orphaned file context warnings (startup cleanup)
	FileContextTracker.cleanupOrphanedWarnings(stateManager)

	telemetryService.captureExtensionActivated()

	Logger.debug(`[Dline] common.initialize: done +${Math.round(performance.now() - initStart)}ms`)
	return webview
}

async function showVersionUpdateAnnouncement(stateManager: StateManager) {
	// Version checking for autoupdate notification
	const currentVersion = ExtensionRegistryInfo.version
	const previousVersion = stateManager.getGlobalStateKey("version")
	// Perform post-update actions if necessary
	try {
		if (!previousVersion || currentVersion !== previousVersion) {
			Logger.log(`Dline version changed: ${previousVersion} -> ${currentVersion}. First run or update detected.`)

			// Check if there's a new announcement to show
			const lastShownAnnouncementId = stateManager.getGlobalStateKey("lastShownAnnouncementId")
			const latestAnnouncementId = getLatestAnnouncementId()

			if (lastShownAnnouncementId !== latestAnnouncementId) {
				// Show notification when there's a new announcement (major/minor updates or fresh installs)
				const message = previousVersion
					? `Dline has been updated to v${currentVersion}`
					: `Welcome to Dline v${currentVersion}`
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message,
				})
			}
			// Always update the main version tracker for the next launch.
			await stateManager.setGlobalState("version", currentVersion)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		Logger.error(`Error during post-update actions: ${errorMessage}, Stack trace: ${error.stack}`)
	}
}

/**
 * Checks if this workspace was opened from the worktree quick launch button.
 * If so, opens the Cline sidebar and clears the state.
 */
async function checkWorktreeAutoOpen(stateManager: StateManager): Promise<void> {
	try {
		// Read directly from globalState (not StateManager cache) since this may have been
		// set by another window right before this one opened
		const worktreeAutoOpenPath = stateManager.getGlobalStateKey("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		// Get current workspace path
		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
		if (workspacePaths.length === 0) {
			return
		}

		const currentPath = workspacePaths[0]

		// Check if current workspace matches the worktree path
		if (arePathsEqual(currentPath, worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			stateManager.setGlobalState("worktreeAutoOpenPath", undefined)
			// Open the Cline sidebar
			await HostProvider.workspace.openClineSidebarPanel({})
		}
	} catch (error) {
		Logger.error("Error checking worktree auto-open", error)
	}
}

/**
 * Performs cleanup when Cline is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	AgentConfigLoader.getInstance()?.dispose()
	PostHogClientProvider.getInstance().dispose()
	telemetryService.dispose()
	ErrorService.get().dispose()
	featureFlagsService.dispose()

	// Flush once before controller disposal so edits made by Settings controls are
	// durable, then flush again as part of StateManager shutdown for cleanup writes
	// produced while controllers release their task resources.
	try {
		await StateManager.get().flushPendingState()
	} catch (error) {
		Logger.error("[Dline] Initial StateManager shutdown flush failed:", error)
	}

	// Dispose all webview instances
	await WebviewProvider.disposeAllInstances()

	// Task history writes are queued per workspace and settle off the UI hot
	// path, so they must be drained here: controllers are gone but the store is
	// still open, and StateManager.shutdown() closes it.
	try {
		await flushAllWorkspaceHistoryManagers()
	} catch (error) {
		Logger.error("[Dline] Task history shutdown flush failed:", error)
	}

	await StateManager.shutdown()
	syncWorker().dispose()
	clearOnboardingModelsCache()

	// Kill any running hook processes to prevent zombies
	await HookProcessRegistry.terminateAll()
	// Clean up hook discovery cache
	HookDiscoveryCache.getInstance().dispose()
	// Stop periodic temp file cleanup
	DlineRuntimeFileManager.stopPeriodicCleanup()

	// Clean up test mode
	cleanupTestMode()
}
