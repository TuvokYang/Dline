import { PROVIDER_API_KEY_MAP, readApiProfiles } from "@core/controller/file/getApiProfiles"
import { type AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type { HistoryItem } from "@shared/HistoryItem"
import {
	type GlobalState,
	type GlobalStateAndSettings,
	type GlobalStateAndSettingsKey,
	getDefaultValue,
	isSecretKey,
	isSettingsKey,
	type LocalState,
	type LocalStateKey,
	type RemoteConfigFields,
	type SecretKey,
	SecretKeys,
	type Secrets,
	type Settings,
	type SettingsKey,
	SettingsKeys,
} from "@shared/storage/state-keys"
import type { StorageContext } from "@shared/storage/storage-context"
import { taskServiceTierOverrideFromFields } from "@shared/task-provider-overrides"
import { taskReasoningOverrideFromFields } from "@shared/task-reasoning"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { AgentConfigLoader } from "../task/tools/subagent/AgentConfigLoader"
import { readTaskSettingsFromStorage, writeTaskHistoryToState, writeTaskSettingsToStorage } from "./disk"
import { STATE_MANAGER_NOT_INITIALIZED } from "./error-messages"
import { JsonlIndexedStore } from "./JsonlIndexedStore"
import { filterAllowedRemoteConfigFields } from "./remote-config/utils"
import {
	getAccountApiKey,
	getAccountId,
	getFirebaseAccountId,
	getWandbApiKey,
	setAccountApiKey,
	setAccountId,
	setFirebaseAccountId,
	setWandbApiKey,
} from "./secrets"
import { SettingsRepository } from "./settings/SettingsRepository"
import type { SettingsCommit, SettingsSnapshot } from "./settings/settings-types"
import { TaskHistory } from "./TaskHistory"
import { readGlobalStateFromStorage, readSecretsFromStorage, readWorkspaceStateFromStorage } from "./utils/state-helpers"
export interface PersistenceErrorEvent {
	error: Error
}

export type StateSyncEvent =
	| { readonly source: "settings"; readonly commit: SettingsCommit }
	| { readonly source: "task_history" }

/**
 * In-memory state manager for fast state access.
 * Provides immediate reads/writes with async disk persistence.
 *
 * All persistent storage is backed by file-based stores via StorageContext.
 * This is shared across all platforms (VSCode, CLI, JetBrains).
 *
 * MULTI-INSTANCE BEHAVIOR:
 * Settings are committed through the revisioned SettingsRepository. Each instance keeps an
 * in-memory snapshot for reads, reconciles higher committed revisions through a file watcher,
 * and publishes committed changes to every registered controller in the process.
 *
 * Task-scoped state remains isolated by task ID. Global Settings are shared facts and converge
 * across running VS Code instances without allowing stale full-file writes to overwrite newer
 * keys.
 */
export class StateManager {
	private static instance: StateManager | null = null

	private globalStateCache: GlobalStateAndSettings = {} as GlobalStateAndSettings
	/** Settings cache — non-deprecated SETTINGS_FIELDS, persisted to settings/settings.json */
	private settingsCache: Settings = {} as Settings
	/** Legacy/global defaults used only while the first canonical Settings snapshot is applied. */
	private settingsFallbackCache: Partial<Settings> = {}
	private settingsFallbackActive = true
	/** Per-task settings cache keyed by taskId. null/undefined keys use empty fallback. */
	private taskStateCache = new Map<string, Partial<Settings>>()
	private sessionOverrideCache: Partial<Settings> = {}
	/** The taskId that loaded its settings most recently. Used for reading per-task cache. */
	private activeTaskId?: string
	private remoteConfigCache: Partial<RemoteConfigFields> = {} as RemoteConfigFields
	private secretsCache: Secrets = {} as Secrets
	private workspaceStateCache: LocalState = {} as LocalState

	/**
	 * File-backed storage context. All reads/writes to persistent state go through here.
	 * Do NOT access VSCode's ExtensionContext for storage — use this instead.
	 */
	private storage: StorageContext
	private settingsRepository?: SettingsRepository
	private settingsRepositoryUnsubscribe?: () => void
	private appliedSettingsRevision = 0
	private isInitialized = false

	// Cache TTL: 1 hour - long enough to prevent duplicate fetches, short enough to see new models
	private readonly MODEL_CACHE_TTL_MS = 60 * 60 * 1000

	// In-memory model info cache (not persisted to disk)
	// These are for dynamic providers that fetch models from APIs
	private modelInfoCache: {
		clineModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		openRouterModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		groqModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		basetenModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		huggingFaceModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		requestyModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		huaweiCloudMaasModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		hicapModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		aihubmixModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		liteLlmModels: { data: Record<string, ModelInfo>; timestamp: number } | null
		vercelModels: { data: Record<string, ModelInfo>; timestamp: number } | null
	} = {
		clineModels: null,
		openRouterModels: null,
		groqModels: null,
		basetenModels: null,
		huggingFaceModels: null,
		requestyModels: null,
		huaweiCloudMaasModels: null,
		hicapModels: null,
		aihubmixModels: null,
		liteLlmModels: null,
		vercelModels: null,
	}

	// Debounced persistence state
	private pendingGlobalState = new Set<GlobalStateAndSettingsKey>()
	/** Pending settings keys to persist to settings.json */
	private pendingSettings = new Set<SettingsKey>()
	private pendingTaskState = new Map<string, Set<SettingsKey>>()
	private pendingSecrets = new Set<SecretKey>()
	private pendingWorkspaceState = new Set<LocalStateKey>()
	private persistenceTimeout: NodeJS.Timeout | null = null
	private persistenceQueue: Promise<void> = Promise.resolve()
	private shuttingDown = false
	private shutdownPromise?: Promise<void>
	private readonly PERSISTENCE_DELAY_MS = 2000

	// Callbacks for persistence errors — multiple controllers may register.
	private onPersistenceErrorCallbacks = new Set<(event: PersistenceErrorEvent) => void | Promise<void>>()

	// Callbacks to sync external state changes — multiple controllers may register.
	private onSyncExternalChangeCallbacks = new Set<(event: StateSyncEvent) => void | Promise<void>>()

	/** TaskHistory instance (cross-process safe via JsonlIndexedStore). */
	private _taskHistory: TaskHistory | null = null

	/** @deprecated Use the Set-based callbacks below. Kept for external compatibility. */
	onPersistenceError?: (event: PersistenceErrorEvent) => void

	/** @deprecated Use the Set-based callbacks below. Kept for external compatibility. */
	onSyncExternalChange?: (event: StateSyncEvent) => void | Promise<void>

	private constructor(storage: StorageContext) {
		this.storage = storage
	}

	/**
	 * Initialize the cache by loading data from the file-backed StorageContext.
	 */
	public static async initialize(storage: StorageContext): Promise<StateManager> {
		if (!StateManager.instance) {
			StateManager.instance = new StateManager(storage)
		}

		if (StateManager.instance.isInitialized) {
			throw new Error("StateManager has already been initialized.")
		}

		try {
			await initializeDistinctId(storage)

			// Load all extension state from file-backed stores
			const globalState = await readGlobalStateFromStorage(storage.globalState)
			const secrets = readSecretsFromStorage(storage.secrets)
			const workspaceState = readWorkspaceStateFromStorage(storage.workspaceState)

			// Populate non-Settings caches without triggering persistence during initialization.
			StateManager.instance.populateCache(globalState, secrets, workspaceState)
			StateManager.instance.captureSettingsFallbackCache()

			// Load Settings from the canonical repository after global state so the
			// committed Settings snapshot remains authoritative for overlapping keys.
			await StateManager.loadAndMigrateSettings(storage, globalState)

			// Create TaskHistory inside the injected storage boundary.
			const filePath = storage.taskHistoryPath
			const fs = await import("fs/promises")

			// Migrate from legacy JSON if needed
			const legacyPath = filePath.replace(/\.jsonl$/, ".json")
			if (!(await fileExistsAtPath(filePath)) && (await fileExistsAtPath(legacyPath))) {
				try {
					const raw = await fs.readFile(legacyPath, "utf8")
					if (raw.trim()) {
						const items = JSON.parse(raw)
						if (Array.isArray(items) && items.length > 0) {
							await writeTaskHistoryToState(items, filePath)
							await fs.rename(legacyPath, `${legacyPath}.bak`).catch(() => {})
						}
					}
				} catch {
					// Migration failed — proceed with empty store
				}
			}

			const store = await JsonlIndexedStore.open<HistoryItem>(filePath, 10000) // 10s flush for global file
			const taskHistory = new TaskHistory(store)
			await taskHistory.startWatcher(filePath)
			taskHistory.onChange(async () => {
				// Notify controllers of external task history changes
				const callbacks = StateManager.instance?.onSyncExternalChangeCallbacks
				if (!callbacks) return
				for (const cb of callbacks) {
					try {
						await cb({ source: "task_history" })
					} catch {
						/* ignore */
					}
				}
			})
			StateManager.instance._taskHistory = taskHistory

			// Populate initial taskHistory cache
			const initialHistory = await taskHistory.getDeduplicated()
			StateManager.instance.globalStateCache.taskHistory = initialHistory

			StateManager.instance.isInitialized = true

			// Start agent config loading in background — does NOT block initialization
			AgentConfigLoader.getInstance()
		} catch (error) {
			Logger.error("[StateManager] Failed to initialize:", error)
			throw error
		}

		return StateManager.instance
	}

	/**
	 * Load settings from settings/settings.json.
	 * If settings.json doesn't exist or hasn't been migrated, extract non-deprecated
	 * SettingsKeys from globalState and write to settings.json.
	 */
	private static async loadAndMigrateSettings(storage: StorageContext, globalState: GlobalStateAndSettings): Promise<void> {
		const instance = StateManager.instance!
		const SETTINGS_MIGRATION_VERSION_KEY = "__settingsMigrationVersion"
		const repository = new SettingsRepository({ filePath: storage.settingsFilePath })
		instance.settingsRepository = repository
		instance.settingsRepositoryUnsubscribe = repository.subscribe((commit) => instance.applySettingsCommit(commit))

		await repository.initialize()
		instance.applySettingsSnapshot(repository.readSnapshot())

		const existingSentinel = (repository.readSnapshot().values as Record<string, unknown>)[SETTINGS_MIGRATION_VERSION_KEY]
		if (typeof existingSentinel === "number" && existingSentinel >= 1) {
			instance.disableSettingsFallback()
			return
		}

		// Deprecated Settings remain in legacy global state and are not copied into
		// the canonical Settings document during the one-time migration.
		const deprecatedSettings = new Set([
			"planModeOcaModelId",
			"planModeOcaModelInfo",
			"planModeOcaReasoningEffort",
			"actModeOcaModelId",
			"actModeOcaModelInfo",
			"actModeOcaReasoningEffort",
			"planModeOpenRouterModelId",
			"planModeOpenRouterModelInfo",
			"actModeOpenRouterModelId",
			"actModeOpenRouterModelInfo",
			"liteLlmBaseUrl",
			"requestyBaseUrl",
			"ocaMode",
			"planModeReasoningEffort",
			"actModeReasoningEffort",
		])
		const settingsEntries: Record<string, unknown> = {}
		for (const key of SettingsKeys) {
			if (deprecatedSettings.has(key as string)) continue
			const value = (globalState as Record<string, unknown>)[key as string]
			if (value !== undefined) {
				settingsEntries[key as string] = value
			}
		}
		settingsEntries[SETTINGS_MIGRATION_VERSION_KEY] = 1

		await repository.mutate(settingsEntries as Partial<Settings>)
		instance.applySettingsSnapshot(repository.readSnapshot())
		instance.disableSettingsFallback()
	}

	private captureSettingsFallbackCache(): void {
		const fallback = this.settingsFallbackCache as Record<string, unknown>
		const global = this.globalStateCache as Record<string, unknown>
		for (const key of SettingsKeys) {
			const value = global[key as string]
			if (value !== undefined) {
				fallback[key as string] = value
			}
		}
	}

	private async applySettingsCommit(commit: SettingsCommit): Promise<void> {
		if (commit.revision <= this.appliedSettingsRevision) {
			return
		}
		this.applySettingsSnapshot(commit.snapshot)
		await this.notifySyncExternalChange({ source: "settings", commit })
	}

	private applySettingsSnapshot(snapshot: SettingsSnapshot): void {
		const pendingValues = new Map<string, unknown>()
		for (const key of this.pendingSettings) {
			pendingValues.set(key as string, (this.settingsCache as Record<string, unknown>)[key as string])
		}

		this.settingsCache = { ...(snapshot.values as Settings) }
		this.appliedSettingsRevision = snapshot.revision
		const settingsRecord = this.settingsCache as Record<string, unknown>
		const globalRecord = this.globalStateCache as Record<string, unknown>
		for (const key of SettingsKeys) {
			const keyName = key as string
			const value = settingsRecord[keyName]
			if (value !== undefined) {
				globalRecord[keyName] = value
				continue
			}

			const fallbackValue = this.settingsFallbackActive
				? (this.settingsFallbackCache as Record<string, unknown>)[keyName]
				: undefined
			if (fallbackValue !== undefined) {
				globalRecord[keyName] = fallbackValue
				continue
			}

			const defaultValue = getDefaultValue(key)
			if (defaultValue !== undefined) {
				globalRecord[keyName] = defaultValue
			} else {
				delete globalRecord[keyName]
			}
		}

		// Preserve optimistic local mutations until their own transaction commits.
		for (const [key, value] of pendingValues) {
			if (value === undefined) {
				// The missing Settings key has already been projected to its declared
				// default above; only remove the explicit value from the canonical cache.
				delete settingsRecord[key]
			} else {
				settingsRecord[key] = value
				globalRecord[key] = value
			}
		}
	}

	private disableSettingsFallback(): void {
		this.settingsFallbackActive = false
		this.settingsFallbackCache = {}
	}

	private async notifySyncExternalChange(event: StateSyncEvent): Promise<void> {
		const callbacks = new Set(this.onSyncExternalChangeCallbacks)
		if (this.onSyncExternalChange) {
			callbacks.add(this.onSyncExternalChange)
		}
		for (const callback of callbacks) {
			try {
				await callback(event)
			} catch (error) {
				Logger.error("[StateManager] Failed to broadcast committed Settings state:", error)
			}
		}
	}

	public static get(): StateManager {
		if (!StateManager.instance) {
			throw new Error("StateManager has not been initialized")
		}
		return StateManager.instance
	}

	/** Reset the singleton for testing after all owned watcher resources have closed. */
	public static async resetForTest(): Promise<void> {
		const instance = StateManager.instance
		StateManager.instance = null
		if (!instance) {
			return
		}

		const taskHistory = instance._taskHistory
		instance._taskHistory = null
		await Promise.all([instance.dispose(), taskHistory?.dispose(), AgentConfigLoader.resetInstanceForTests()])
	}

	/**
	 * Flush and dispose the singleton after all consumers have stopped using it.
	 * The singleton remains visible until disposal completes so late cleanup can
	 * still unregister callbacks against the same StateManager instance.
	 */
	public static async shutdown(): Promise<void> {
		const instance = StateManager.instance
		if (!instance) return
		if (!instance.shutdownPromise) {
			instance.shutdownPromise = instance.shutdownInstance()
		}

		try {
			await instance.shutdownPromise
			StateManager.instance = null
		} catch (error) {
			instance.shutdownPromise = undefined
			throw error
		}
	}

	private async shutdownInstance(): Promise<void> {
		this.shuttingDown = true
		try {
			await this.flushPendingState()
			const taskHistory = this._taskHistory
			this._taskHistory = null
			await Promise.all([this.dispose(), taskHistory?.dispose()])
		} catch (error) {
			this.shuttingDown = false
			throw error
		}
	}

	/**
	 * Register callbacks for state manager events.
	 * Multiple callers can register simultaneously — callbacks are appended
	 * to a Set so the last-registered controller does not shadow earlier ones.
	 *
	 * Returns a disposal function that removes the registered callbacks.
	 * Callers should invoke the disposal function when their lifecycle ends
	 * (e.g. Controller.dispose()) so closed windows don't keep receiving
	 * state-change notifications.
	 */
	public registerCallbacks(callbacks: {
		onPersistenceError?: (event: PersistenceErrorEvent) => void | Promise<void>
		onSyncExternalChange?: (event: StateSyncEvent) => void | Promise<void>
	}): () => void {
		const { onPersistenceError, onSyncExternalChange } = callbacks

		if (onPersistenceError) {
			this.onPersistenceErrorCallbacks.add(onPersistenceError)
			// Backward-compat: keep the single-slot reference for external consumers
			this.onPersistenceError = onPersistenceError
		}
		if (onSyncExternalChange) {
			this.onSyncExternalChangeCallbacks.add(onSyncExternalChange)
			// Backward-compat
			this.onSyncExternalChange = onSyncExternalChange
		}

		// Return a disposal function so the caller can unregister itself
		return () => {
			if (onPersistenceError) {
				this.onPersistenceErrorCallbacks.delete(onPersistenceError)
			}
			if (onSyncExternalChange) {
				this.onSyncExternalChangeCallbacks.delete(onSyncExternalChange)
			}
		}
	}

	/**
	 * Set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalState<K extends keyof GlobalStateAndSettings>(key: K, value: GlobalStateAndSettings[K] | undefined): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update cache immediately for instant access. The public setter permits
		// undefined as an explicit delete value even for fields with a default.
		;(this.globalStateCache as Record<string, unknown>)[key as string] = value

		// Add to pending persistence set and schedule debounced write
		this.pendingGlobalState.add(key)

		// @deprecated Phase B dual-write for settings.
		// When key is a SettingsKey, also write to settings.json.
		// Remove dual-write in Phase C — settings go to settings.json only.
		if (isSettingsKey(key as string)) {
			;(this.settingsCache as Record<string, unknown>)[key as string] = value
			this.pendingSettings.add(key as unknown as SettingsKey)
		}

		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalStateBatch(updates: Partial<GlobalStateAndSettings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update the legacy cache and route every Settings key through the same
		// canonical repository path used by setGlobalState().
		Object.assign(this.globalStateCache, updates)
		const updateRecord = updates as Record<string, unknown>
		const settingsRecord = this.settingsCache as Record<string, unknown>

		for (const key of Object.keys(updates)) {
			this.pendingGlobalState.add(key as GlobalStateAndSettingsKey)
			if (isSettingsKey(key)) {
				settingsRecord[key] = updateRecord[key]
				this.pendingSettings.add(key as SettingsKey)
			}
		}

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	private setRemoteConfigState(updates: Partial<GlobalStateAndSettings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache in one go
		this.remoteConfigCache = {
			...this.remoteConfigCache,
			...filterAllowedRemoteConfigFields(updates),
		}
	}

	/**
	 * Get or create a per-task cache entry. Returns the cache for the given task.
	 */
	private getOrCreateTaskCache(taskId: string): Partial<Settings> {
		let cache = this.taskStateCache.get(taskId)
		if (!cache) {
			cache = {}
			this.taskStateCache.set(taskId, cache)
		}
		return cache
	}

	/**
	 * Expose the raw cache entry for a task so that TaskStateManager
	 * can hold a direct reference.  Mutations to the returned object
	 * are immediately visible to this StateManager — no activeTaskId
	 * routing required.
	 *
	 * @param taskId The task to get a cache reference for
	 * @returns The mutable cache entry (created if missing)
	 */
	getTaskCacheRef(taskId: string): Partial<Settings> {
		return this.getOrCreateTaskCache(taskId)
	}

	/**
	 * Mark a task-scoped setting as dirty so it will be persisted
	 * on the next debounced write.  Used by TaskStateManager when
	 * it writes a setting via its direct cache reference.
	 *
	 * @param taskId The task whose setting changed
	 * @param key The setting key that was modified
	 */
	markTaskSettingDirty(taskId: string, key: SettingsKey): void {
		this.ensureMutationAllowed()
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		this.pendingTaskState.get(taskId)?.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Switch the active task context for per-task settings reads.
<｜｜DSML｜｜parameter name="task_progress" string="true">- [x] 创建 TaskStateManager 类
- [ ] 修改 TaskParams 接口添加 taskStateManager
- [ ] 修改 Task 构造函数，存储 taskStateManager，替换 7 处 getGlobalSettingsKey("mode")
- [ ] 修改 Controller.initTask 创建 TaskStateManager 并传入
- [ ] 修改 Controller.togglePlanActMode 使用 task.taskSm.setMode()
- [ ] 修改 Controller.getStateToPostToWebview 从 task.taskSm.mode 读取
- [x] 在 StateManager 中添加 getTaskCacheRef 和 markTaskSettingDirty 方法
	 * Called by Controller.initTask() and OrchestratorController when switching between tasks.
	 */
	setActiveTask(taskId: string): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.activeTaskId = taskId
		// Ensure the cache entry exists
		this.getOrCreateTaskCache(taskId)
	}

	/**
	 * Set method for task settings keys - updates cache immediately and schedules debounced persistence
	 */
	setTaskSettings<K extends keyof Settings>(taskId: string, key: K, value: Settings[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update per-task cache immediately for instant access
		const cache = this.getOrCreateTaskCache(taskId)
		cache[key] = value

		// Add to pending persistence set and schedule debounced write
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		this.pendingTaskState.get(taskId)?.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Clear one task-scoped setting so reads fall back to global settings.
	 */
	clearTaskSetting<K extends keyof Settings>(taskId: string, key: K): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		const cache = this.getOrCreateTaskCache(taskId)
		delete cache[key]

		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		this.pendingTaskState.get(taskId)?.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for task settings keys - updates cache immediately and schedules debounced persistence
	 */
	setTaskSettingsBatch(taskId: string, updates: Partial<Settings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update per-task cache in one go
		const cache = this.getOrCreateTaskCache(taskId)
		Object.assign(cache, updates)

		// Then track the keys for persistence
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		Object.keys(updates).forEach((key) => {
			this.pendingTaskState.get(taskId)?.add(key as SettingsKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set the active task ID for per-task settings isolation.
	 * Called by Controller before reading task-level settings via getGlobalSettingsKey.
	 */
	setActiveTaskId(taskId: string | undefined): void {
		this.activeTaskId = taskId
	}

	/**
	 * Load task settings from disk into cache
	 */
	async loadTaskSettings(taskId: string): Promise<void> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Set this task as the active one so getGlobalSettingsKey reads the correct cache
		this.activeTaskId = taskId

		try {
			const taskSettings = await readTaskSettingsFromStorage(taskId)
			// Populate per-task cache with loaded settings
			const cache = this.getOrCreateTaskCache(taskId)
			Object.assign(cache, taskSettings)
		} catch (error) {
			// If reading fails, just use empty cache for this task
			Logger.error("[StateManager] Failed to load task settings, defaulting to globally selected settings.", error)
		}
	}

	/**
	 * Clear task settings cache - ensures pending changes are persisted first
	 */
	async clearTaskSettings(taskId?: string): Promise<void> {
		// If there are pending task settings, persist them first
		if (this.pendingTaskState.size > 0) {
			try {
				// Persist pending task state immediately
				await this.persistTaskStateBatch(this.pendingTaskState)
				// Clear pending set after successful persistence
				this.pendingTaskState.clear()
			} catch (error) {
				Logger.error("[StateManager] Failed to persist task settings before clearing:", error)
			}
		}

		// Clear the explicitly requested task. Legacy callers without an ID still
		// target activeTaskId, but multi-controller callers must not depend on it.
		const targetTaskId = taskId ?? this.activeTaskId
		if (targetTaskId) {
			this.taskStateCache.delete(targetTaskId)
			if (this.activeTaskId === targetTaskId) {
				this.activeTaskId = undefined
			}
		}
		this.pendingTaskState.clear()
	}

	/**
	 * Set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Route to split stores for migrated keys
		switch (key) {
			case "clineApiKey":
				setAccountApiKey(value as string)
				return
			case "clineAccountId":
				setAccountId(value as string)
				return
			case "cline:clineAccountId":
				setFirebaseAccountId(value as string)
				return
			case "wandbApiKey":
				setWandbApiKey(value as string)
				return
			default: {
				// Update legacy cache for non-migrated keys
				this.secretsCache[key] = value
				this.pendingSecrets.add(key)
				this.scheduleDebouncedPersistence()
			}
		}
	}

	/**
	 * Batch set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecretsBatch(updates: Partial<Secrets>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			// Skip unchanged values as we don't want to trigger unnecessary
			// writes & incorrectly fire an onDidChange events.
			const current = this.secretsCache[key as keyof Secrets]
			if (current === value) {
				return
			}
			this.secretsCache[key as keyof Secrets] = value
			this.pendingSecrets.add(key as SecretKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceState<K extends keyof LocalState>(key: K, value: LocalState[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update cache immediately for instant access
		this.workspaceStateCache[key] = value

		// Add to pending persistence set and schedule debounced write
		this.pendingWorkspaceState.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceStateBatch(updates: Partial<LocalState>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.ensureMutationAllowed()

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.workspaceStateCache[key as keyof LocalState] = value
			this.pendingWorkspaceState.add(key as LocalStateKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set a session-scoped override for a settings key.
	 * Session overrides are in-memory only and are NEVER persisted to disk.
	 * They take precedence after remote config but before task-specific and global settings.
	 *
	 * Use this for CLI flags like --yolo that should apply for the current
	 * process lifetime only, without modifying the user's saved settings.
	 */
	setSessionOverride<K extends keyof Settings>(key: K, value: Settings[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		this.sessionOverrideCache[key] = value
	}

	/**
	 * Set method for remote config field - updates cache immediately (no persistence)
	 * Remote config is read-only from the extension's perspective and only stored in memory
	 */
	setRemoteConfigField<K extends keyof RemoteConfigFields>(key: K, value: RemoteConfigFields[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access (no persistence needed)
		this.remoteConfigCache[key] = value
	}

	/**
	 * Get method for remote config settings - returns cache immediately (no persistence)
	 * Remote config is read-only from the extension's perspective and only stored in memory
	 */
	getRemoteConfigSettings(): Partial<RemoteConfigFields> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		return this.remoteConfigCache
	}

	/**
	 * Clear remote config cache
	 * Used when switching organizations or when remote config is no longer applicable
	 */
	clearRemoteConfig(): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		this.remoteConfigCache = {} as GlobalStateAndSettings
	}

	/**
	 * Atomically replace the entire remote config cache.
	 * Use this instead of clearRemoteConfig() + setRemoteConfigField() loops
	 * to avoid a window where the cache is empty and concurrent readers get stale data.
	 */
	replaceRemoteConfig(newCache: Partial<RemoteConfigFields>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		this.remoteConfigCache = { ...newCache }
	}

	/**
	 * Set models cache for a specific provider (in-memory only, not persisted)
	 */
	setModelsCache(
		provider:
			| "cline"
			| "openRouter"
			| "groq"
			| "baseten"
			| "huggingFace"
			| "requesty"
			| "huaweiCloudMaas"
			| "hicap"
			| "aihubmix"
			| "liteLlm"
			| "vercel",
		models: Record<string, ModelInfo>,
	): void {
		const cacheKey = `${provider}Models` as keyof typeof this.modelInfoCache
		this.modelInfoCache[cacheKey] = { data: models, timestamp: Date.now() }
	}

	getModelsCache(
		provider:
			| "cline"
			| "openRouter"
			| "groq"
			| "baseten"
			| "huggingFace"
			| "requesty"
			| "huaweiCloudMaas"
			| "hicap"
			| "aihubmix"
			| "liteLlm"
			| "vercel",
	): Record<string, ModelInfo> | null {
		const cacheKey = `${provider}Models` as keyof typeof this.modelInfoCache
		const cached = this.modelInfoCache[cacheKey]

		if (!cached) {
			return null
		}

		// Check if cache has expired
		if (Date.now() - cached.timestamp > this.MODEL_CACHE_TTL_MS) {
			this.modelInfoCache[cacheKey] = null
			return null
		}

		return cached.data
	}

	/**
	 * Get model info by provider and model ID (from in-memory cache)
	 */
	getModelInfo(
		provider:
			| "openRouter"
			| "groq"
			| "baseten"
			| "huggingFace"
			| "requesty"
			| "huaweiCloudMaas"
			| "hicap"
			| "aihubmix"
			| "liteLlm",
		modelId: string,
	): ModelInfo | undefined {
		const cacheKey = `${provider}Models` as keyof typeof this.modelInfoCache
		const cached = this.modelInfoCache[cacheKey]

		if (!cached) {
			return undefined
		}

		// Check if cache has expired
		if (Date.now() - cached.timestamp > this.MODEL_CACHE_TTL_MS) {
			this.modelInfoCache[cacheKey] = null
			return undefined
		}

		return cached.data[modelId]
	}

	/**
	 * Convenience method for getting API configuration
	 * Ensures cache is initialized if not already done
	 */
	getApiConfiguration(): ApiConfiguration {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Construct API configuration from cached component keys
		return this.constructApiConfigurationFromCache(this.activeTaskId)
	}

	/**
	 * Build API configuration for an explicit task without mutating the shared
	 * activeTaskId routing cursor used by legacy callers.
	 */
	getApiConfigurationForTask(taskId?: string): ApiConfiguration {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return this.constructApiConfigurationFromCache(taskId)
	}

	/** Resolve a settings value for one explicit task without changing activeTaskId. */
	getSettingsKeyForTask<K extends keyof Settings>(key: K, taskId?: string): Settings[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return this.getSettingWithOverrideForTask(key, taskId)
	}

	/**
	 * Convenience method for setting API configuration
	 * Automatically categorizes keys based on STATE_DEFINITION and SecretKeys
	 */
	setApiConfiguration(apiConfiguration: ApiConfiguration): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Automatically categorize the API configuration keys
		const { settingsUpdates, secretsUpdates } = Object.entries(apiConfiguration).reduce(
			(acc, [key, value]) => {
				if (key === undefined || value === undefined) {
					return acc // Skip undefined values
				}

				if (isSecretKey(key)) {
					// This is a secret key
					acc.secretsUpdates[key as keyof Secrets] = value as any
				} else if (isSettingsKey(key)) {
					// This is a settings key
					acc.settingsUpdates[key as keyof Settings] = value as any
				}

				return acc
			},
			{ settingsUpdates: {} as Partial<Settings>, secretsUpdates: {} as Partial<Secrets> },
		)

		// Batch update settings (stored in global state)
		if (Object.keys(settingsUpdates).length > 0) {
			this.setRemoteConfigState(settingsUpdates)
			this.setGlobalStateBatch(settingsUpdates)
		}

		// Batch update secrets
		if (Object.keys(secretsUpdates).length > 0) {
			this.setSecretsBatch(secretsUpdates)
		}
	}

	/**
	 * Get method for global settings keys - reads from in-memory cache
	 * Precedence: remote config > session override > task settings > global settings
	 */
	getCanonicalSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		if (this.remoteConfigCache[key] !== undefined) {
			return this.remoteConfigCache[key] as Settings[K]
		}
		if (this.sessionOverrideCache[key] !== undefined) {
			return this.sessionOverrideCache[key] as Settings[K]
		}
		if (this.settingsCache[key] !== undefined) {
			return this.settingsCache[key]
		}
		return this.globalStateCache[key]
	}

	getGlobalSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		if (this.remoteConfigCache[key] !== undefined) {
			return this.remoteConfigCache[key] as Settings[K]
		}
		if (this.sessionOverrideCache[key] !== undefined) {
			return this.sessionOverrideCache[key] as Settings[K]
		}
		// Auto-Approve is a live global permission. A historical Task snapshot must
		// never shadow changes made from this or another running VS Code instance.
		if (key === "autoApprovalSettings") {
			return this.getCanonicalSettingsKey(key)
		}
		// Look up the active task's cache to support per-task settings isolation
		if (this.activeTaskId) {
			const taskCache = this.taskStateCache.get(this.activeTaskId)
			if (taskCache && taskCache[key] !== undefined) {
				return taskCache[key]
			}
		}
		// Phase B: prefer settingsCache, fallback to globalStateCache
		if (this.settingsCache[key] !== undefined) {
			return this.settingsCache[key]
		}
		return this.globalStateCache[key]
	}

	/** Atomically merge Auto-Approve changes against the latest cross-process Settings snapshot. */
	async updateAutoApprovalSettings(patch: {
		version?: number
		actions?: Partial<AutoApprovalSettings["actions"]>
		enableNotifications?: boolean
	}): Promise<AutoApprovalSettings> {
		this.ensureMutationAllowed()
		await this.flushPendingState()
		const repository = this.settingsRepository
		if (!repository) throw new Error("Settings repository is not initialized")

		const commit = await repository.mutateResolved((values) => {
			const current = values.autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS
			const currentVersion = current.version ?? DEFAULT_AUTO_APPROVAL_SETTINGS.version
			const version = Math.max(currentVersion + 1, patch.version ?? 0)
			return {
				autoApprovalSettings: {
					...current,
					version,
					...(patch.enableNotifications === undefined ? {} : { enableNotifications: patch.enableNotifications }),
					actions: { ...current.actions, ...patch.actions },
				},
			}
		})
		const committed = commit.snapshot.values.autoApprovalSettings
		if (!committed) throw new Error("Auto-Approve Settings transaction completed without a value")
		return committed
	}

	/**
	 * Get method for global state keys - reads from in-memory cache
	 */
	getGlobalStateKey<K extends keyof GlobalState>(key: K): GlobalState[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		if (this.remoteConfigCache[key] !== undefined) {
			return this.remoteConfigCache[key] as GlobalState[K]
		}
		return this.globalStateCache[key]
	}

	/**
	 * Get method for secret keys - routes to split stores for migrated keys,
	 * reads from legacy secretsCache for non-migrated keys.
	 */
	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		// Route to split stores for migrated keys
		switch (key) {
			case "clineApiKey":
				return getAccountApiKey() as Secrets[K]
			case "clineAccountId":
				return getAccountId() as Secrets[K]
			case "cline:clineAccountId":
				return getFirebaseAccountId() as Secrets[K]
			case "wandbApiKey":
				return getWandbApiKey() as Secrets[K]
			default:
				return this.secretsCache[key]
		}
	}

	/**
	 * Get method for workspace state keys - reads from in-memory cache
	 */
	getWorkspaceStateKey<K extends keyof LocalState>(key: K): LocalState[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return this.workspaceStateCache[key]
	}

	/**
	 * Reinitialize the state manager by clearing all state and reloading from disk
	 * Used for error recovery when write operations fail
	 */
	async reInitialize(currentTaskId?: string): Promise<void> {
		await this.flushPendingState()
		const taskHistory = this._taskHistory
		this._taskHistory = null
		await Promise.all([this.dispose(), taskHistory?.dispose()])

		// Reinitialize from the same storage context
		await StateManager.initialize(this.storage)

		// If there's an active task, reload its settings
		if (currentTaskId) {
			await this.loadTaskSettings(currentTaskId)
		}
	}

	/**
	 * Dispose of the state manager
	 */
	private async dispose(): Promise<void> {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}
		this.pendingGlobalState.clear()
		this.pendingSettings.clear()
		this.pendingSecrets.clear()
		this.pendingWorkspaceState.clear()
		this.pendingTaskState.clear()

		this.settingsRepositoryUnsubscribe?.()
		this.settingsRepositoryUnsubscribe = undefined
		const settingsRepository = this.settingsRepository
		this.settingsRepository = undefined
		await settingsRepository?.dispose()

		this.globalStateCache = {} as GlobalStateAndSettings
		this.settingsCache = {} as Settings
		this.settingsFallbackCache = {}
		this.settingsFallbackActive = true
		this.secretsCache = {} as Secrets
		this.workspaceStateCache = {} as LocalState
		this.taskStateCache.clear()
		this.activeTaskId = undefined
		this.remoteConfigCache = {} as GlobalStateAndSettings
		this.sessionOverrideCache = {}
		this.appliedSettingsRevision = 0

		this.isInitialized = false
	}

	/**
	 * Private method to persist all pending state changes
	 * Returns early if nothing is pending
	 */
	private hasPendingState(): boolean {
		return (
			this.pendingGlobalState.size > 0 ||
			this.pendingSettings.size > 0 ||
			this.pendingSecrets.size > 0 ||
			this.pendingWorkspaceState.size > 0 ||
			this.pendingTaskState.size > 0
		)
	}

	private ensureMutationAllowed(): void {
		if (this.shuttingDown) {
			throw new Error("StateManager is shutting down")
		}
	}

	private persistPendingState(): Promise<void> {
		const operation = this.persistenceQueue.then(async () => {
			if (
				this.pendingGlobalState.size === 0 &&
				this.pendingSettings.size === 0 &&
				this.pendingSecrets.size === 0 &&
				this.pendingWorkspaceState.size === 0 &&
				this.pendingTaskState.size === 0
			) {
				return
			}

			// Swap the dirty collections before writing. Mutations created while this
			// batch is in flight land in fresh collections and cannot be cleared by it.
			const pendingGlobalState = this.pendingGlobalState
			const pendingSettings = this.pendingSettings
			const pendingSecrets = this.pendingSecrets
			const pendingWorkspaceState = this.pendingWorkspaceState
			const pendingTaskState = this.pendingTaskState
			this.pendingGlobalState = new Set()
			this.pendingSettings = new Set()
			this.pendingSecrets = new Set()
			this.pendingWorkspaceState = new Set()
			this.pendingTaskState = new Map()

			try {
				await Promise.all([
					this.persistGlobalStateBatch(pendingGlobalState),
					this.persistSettingsBatch(pendingSettings),
					this.persistSecretsBatch(pendingSecrets),
					this.persistWorkspaceStateBatch(pendingWorkspaceState),
					this.persistTaskStateBatch(pendingTaskState),
				])
			} catch (error) {
				// A partially successful batch is safe to retry because each store writes
				// current cache values. Merge failed batch keys behind newer mutations.
				for (const key of pendingGlobalState) this.pendingGlobalState.add(key)
				for (const key of pendingSettings) this.pendingSettings.add(key)
				for (const key of pendingSecrets) this.pendingSecrets.add(key)
				for (const key of pendingWorkspaceState) this.pendingWorkspaceState.add(key)
				for (const [taskId, keys] of pendingTaskState) {
					let currentKeys = this.pendingTaskState.get(taskId)
					if (!currentKeys) {
						currentKeys = new Set()
						this.pendingTaskState.set(taskId, currentKeys)
					}
					for (const key of keys) currentKeys.add(key)
				}
				throw error
			}
		})

		// Keep later flushes ordered even when one caller observes a rejection.
		this.persistenceQueue = operation.catch(() => undefined)
		return operation
	}

	/**
	 * Flush all pending state changes immediately to disk
	 * Bypasses the debounced persistence and forces immediate writes
	 */
	public async flushPendingState(): Promise<void> {
		// Cancel any pending timeout
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}

		// Mutations are normally allowed while a regular flush is in progress. Keep
		// draining until the queue and all dirty collections are empty; shutdown sets
		// shuttingDown first so no new mutation can be admitted during this loop.
		do {
			await this.persistPendingState()
			await this.settingsRepository?.flush()
		} while (this.hasPendingState())
	}

	/**
	 * Schedule debounced persistence - simple timeout-based persistence
	 */
	private scheduleDebouncedPersistence(): void {
		// Clear existing timeout if one is pending
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
		}

		// Schedule a new timeout to persist pending changes. Clear only this timer's
		// token so a mutation created during the write keeps its own debounce timer.
		const timeout = setTimeout(async () => {
			if (this.persistenceTimeout === timeout) {
				this.persistenceTimeout = null
			}
			try {
				await this.persistPendingState()
			} catch (error) {
				Logger.error("[StateManager] Failed to persist pending changes:", error)

				// Call persistence error callback for error recovery
				this.onPersistenceError?.({ error: error })
			}
		}, this.PERSISTENCE_DELAY_MS)
		this.persistenceTimeout = timeout
	}

	/**
	 * Persist settings keys to settings/settings.json via StorageContext.
	 */
	private async persistSettingsBatch(keys: Set<SettingsKey>): Promise<void> {
		if (keys.size === 0) {
			return
		}
		const repository = this.settingsRepository
		if (!repository) {
			throw new Error("Settings repository is not initialized")
		}
		const entries: Partial<Settings> = {}
		const settingsRecord = entries as Record<string, unknown>
		for (const key of keys) {
			settingsRecord[key as string] = (this.settingsCache as Record<string, unknown>)[key as string]
		}
		await repository.mutate(entries)
	}

	/**
	 * Persist global state keys to the file-backed store.
	 * Uses setBatch for efficiency (single disk write).
	 */
	private async persistGlobalStateBatch(keys: Set<GlobalStateAndSettingsKey>): Promise<void> {
		// Separate taskHistory from regular global state.
		// taskHistory is persisted via TaskHistory.upsertTaskHistory()
		// (memory-level + flush timer) — skip it here to avoid full overwrites.
		const regularEntries: Record<string, any> = {}

		for (const key of keys) {
			if (key === "taskHistory") {
				// Mark dirty for periodic flush; do NOT write here
				// taskHistory handled by TaskHistory singleton — no dirty flag needed
			} else {
				regularEntries[key] = this.globalStateCache[key]
			}
		}

		// Batch write all regular keys in a single disk operation
		if (Object.keys(regularEntries).length > 0) {
			this.storage.globalStateBackingStore.setBatch(regularEntries)
		}
	}

	/**
	 * Private method to batch persist task state keys with a single write operation
	 */
	private async persistTaskStateBatch(pendingTaskStates: Map<string, Set<SettingsKey>>): Promise<void> {
		if (pendingTaskStates.size === 0) {
			return
		}
		// Persist each task's settings independently
		await Promise.all(
			Array.from(pendingTaskStates.entries()).map(([taskId, keys]) => {
				if (keys.size === 0) {
					return Promise.resolve()
				}
				const taskCache = this.taskStateCache.get(taskId)
				const settingsToWrite: Record<string, any> = {}
				for (const key of keys) {
					settingsToWrite[key] = taskCache?.[key]
				}
				return writeTaskSettingsToStorage(taskId, settingsToWrite)
			}),
		)
	}

	/**
	 * Persist secrets to the file-backed store.
	 * Uses setBatch for efficiency (single disk write).
	 */
	private async persistSecretsBatch(keys: Set<SecretKey>): Promise<void> {
		const entries: Record<string, string | undefined> = {}
		for (const key of keys) {
			const value = this.secretsCache[key]
			entries[key] = value || undefined // Convert empty strings to undefined (delete)
		}
		this.storage.secrets.setBatch(entries)
	}

	/**
	 * Persist workspace state to the file-backed store.
	 * Uses setBatch for efficiency (single disk write).
	 */
	private async persistWorkspaceStateBatch(keys: Set<LocalStateKey>): Promise<void> {
		const entries: Record<string, any> = {}
		for (const key of keys) {
			entries[key] = this.workspaceStateCache[key]
		}
		this.storage.workspaceState.setBatch(entries)
	}

	/**
	 * Private method to populate cache with all extension state without triggering persistence
	 * Used during initialization
	 */
	private populateCache(globalState: GlobalState, secrets: Secrets, workspaceState: LocalState): void {
		Object.assign(this.globalStateCache, globalState)
		Object.assign(this.secretsCache, secrets)
		Object.assign(this.workspaceStateCache, workspaceState)
	}

	/** Resolve a setting for one explicit task without consulting activeTaskId. */
	private getSettingWithOverrideForTask<K extends keyof Settings>(key: K, taskId?: string): Settings[K] {
		const remoteValue = this.remoteConfigCache[key]
		if (remoteValue !== undefined) {
			return remoteValue
		}
		if (this.sessionOverrideCache[key] !== undefined) {
			return this.sessionOverrideCache[key]
		}
		// Look up the active task's cache to support per-task settings isolation
		if (taskId) {
			const taskCache = this.taskStateCache.get(taskId)
			const taskValue = taskCache?.[key]
			if (taskValue !== undefined) {
				return taskValue
			}
		}
		if (this.settingsCache[key] !== undefined) {
			return this.settingsCache[key]
		}
		return this.globalStateCache[key]
	}

	/**
	 * Helper to get a secret value
	 */
	private getSecret<K extends keyof Secrets>(key: K): Secrets[K] {
		return this.secretsCache[key]
	}

	/**
	 * Construct API configuration from cached component keys.
	 * Additionally fills in apiKey fields from data/secrets/api_keys.json
	 * for any enabled profiles whose keys are missing from secretsCache.
	 */
	private constructApiConfigurationFromCache(taskId?: string): ApiConfiguration {
		// Build secrets object from legacy cache
		const secrets = Object.fromEntries(SecretKeys.map((key) => [key, this.getSecret(key)])) as Secrets

		// Preserve legacy fallback behavior for LiteLLM API key:
		// if a remoteLiteLlmApiKey is set (via remote config), it should
		// take precedence over the local liteLlmApiKey.
		const remoteLiteLlmApiKey = this.secretsCache.remoteLiteLlmApiKey
		if (remoteLiteLlmApiKey !== undefined && remoteLiteLlmApiKey !== null && remoteLiteLlmApiKey !== "") {
			secrets.liteLlmApiKey = remoteLiteLlmApiKey
		}

		// Supplement apiKey fields from api_keys.json for enabled profiles.
		// This ensures apiKeys written by other clients (CLI, JetBrains) are
		// visible even if they haven't been synced to the legacy secretsCache.
		try {
			const profiles = readApiProfiles()
			for (const p of profiles) {
				if (!p.enabled) continue
				const apiKey = (p as any).apiKey as string | undefined
				if (!apiKey) continue
				const apiKeyField = PROVIDER_API_KEY_MAP[p.provider]
				if (apiKeyField && !secrets[apiKeyField as keyof Secrets]) {
					;(secrets as Record<string, string | undefined>)[apiKeyField] = apiKey
				}
			}
		} catch {
			// If api_profiles.json can't be read, fall back to secretsCache only
		}

		const taskCache = taskId ? this.taskStateCache.get(taskId) : undefined
		const planModeReasoningOverride = taskReasoningOverrideFromFields(
			{
				kind: taskCache?.planModeReasoningOverrideKind,
				effort: taskCache?.planModeReasoningOverrideEffort,
				budgetTokens: taskCache?.planModeThinkingBudgetTokens,
			},
			taskCache?.planModeReasoningEffort,
		)
		const actModeReasoningOverride = taskReasoningOverrideFromFields(
			{
				kind: taskCache?.actModeReasoningOverrideKind,
				effort: taskCache?.actModeReasoningOverrideEffort,
				budgetTokens: taskCache?.actModeThinkingBudgetTokens,
			},
			taskCache?.actModeReasoningEffort,
		)
		const planModeServiceTierOverride = taskServiceTierOverrideFromFields({
			kind: taskCache?.planModeServiceTierOverrideKind,
			tier: taskCache?.planModeServiceTierOverrideTier,
		})
		const actModeServiceTierOverride = taskServiceTierOverrideFromFields({
			kind: taskCache?.actModeServiceTierOverrideKind,
			tier: taskCache?.actModeServiceTierOverrideTier,
		})

		return {
			planModeProfileId: this.getSettingWithOverrideForTask("planModeProfileId", taskId),
			planModeProfile: this.getSettingWithOverrideForTask("planModeProfile", taskId),
			actModeProfileId: this.getSettingWithOverrideForTask("actModeProfileId", taskId),
			actModeProfile: this.getSettingWithOverrideForTask("actModeProfile", taskId),
			...(planModeReasoningOverride && { planModeReasoningOverride }),
			...(actModeReasoningOverride && { actModeReasoningOverride }),
			...(planModeServiceTierOverride && { planModeServiceTierOverride }),
			...(actModeServiceTierOverride && { actModeServiceTierOverride }),
			requestTimeoutMs: this.getSettingWithOverrideForTask("requestTimeoutMs", taskId),
			enableParallelToolCalling: this.getSettingWithOverrideForTask("enableParallelToolCalling", taskId),
		} satisfies ApiConfiguration
	}

	/**
	 * Get all global state entries (for debugging/inspection)
	 */
	public getAllGlobalStateEntries(): Record<string, unknown> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return { ...this.globalStateCache }
	}

	/**
	 * Get all workspace state entries (for debugging/inspection)
	 */
	public getAllWorkspaceStateEntries(): Record<string, unknown> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return { ...this.workspaceStateCache }
	}

	/** TaskHistory instance (cross-process safe via JsonlIndexedStore + FileLock). */
	get taskHistory(): TaskHistory {
		if (!this._taskHistory) {
			throw new Error("TaskHistory not initialized.")
		}
		return this._taskHistory
	}
}

/**
 * Load the full task history from disk in the background and update the cache.
 * This runs after initialization completes so that the UI can render immediately
 * with just the recent 5 items loaded during startup.
 *
 * @param stateManager The StateManager instance to update
 */
async function _loadFullTaskHistoryAsync(stateManager: StateManager): Promise<void> {
	try {
		const fullHistory = await stateManager.taskHistory.getDeduplicated()
		// Update cache with full history in a single atomic operation
		stateManager.setGlobalStateBatch({ taskHistory: fullHistory })
	} catch (error) {
		Logger.warn("[StateManager] Failed to load full task history in background:", error)
	}
}
