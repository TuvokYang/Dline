/**
 * ModelRegistry — central service for provider model configuration.
 *
 * Loads provider model configs from ~/.dline/providers/*.json,
 * caches them in memory, and watches for file changes.
 */
import { getDlineHomePath } from "@core/storage/disk"
import { getProviderSeedConfig } from "@shared/providers/model-infos"
import type { ModelInfo, ProviderModelsConfig } from "@shared/providers/types"
import { Logger } from "@shared/services/Logger"
import chokidar, { type FSWatcher } from "chokidar"
import fs from "fs/promises"
import * as path from "path"

const PROVIDERS_DIR_NAME = "providers"

function enrichMissingSeedCapabilities(providerId: string, config: ProviderModelsConfig): ProviderModelsConfig {
	const seedConfig = getProviderSeedConfig(providerId)
	if (!seedConfig) {
		return config
	}

	let models = config.models
	for (const [modelId, model] of Object.entries(config.models)) {
		if (model.capabilities?.supportsTools !== undefined) {
			continue
		}

		const seedSupportsTools = seedConfig.models[modelId]?.capabilities?.supportsTools
		if (seedSupportsTools === undefined) {
			continue
		}

		if (models === config.models) {
			models = { ...config.models }
		}
		models[modelId] = {
			...model,
			capabilities: { ...model.capabilities, supportsTools: seedSupportsTools },
		}
	}

	return models === config.models ? config : { ...config, models }
}

function parseProviderModelsConfig(providerId: string, raw: string): ProviderModelsConfig {
	const config = JSON.parse(raw) as ProviderModelsConfig
	if (!config || typeof config !== "object") {
		throw new Error(`Provider config "${providerId}" must be an object`)
	}
	if (!config.models || typeof config.models !== "object" || Array.isArray(config.models)) {
		throw new Error(`Provider config "${providerId}" must define models as a keyed object`)
	}
	return enrichMissingSeedCapabilities(providerId, config)
}

export class ModelRegistry {
	private static instance?: ModelRegistry
	private cache = new Map<string, ProviderModelsConfig>()
	private watcher: FSWatcher | null = null
	private initialized = false
	private onChangeCallbacks: Array<() => void> = []
	private _version = 0

	/** Monotonically increasing version number, incremented on each reload. */
	get version(): number {
		return this._version
	}

	private constructor() {}

	/** Get the singleton instance. */
	static getInstance(): ModelRegistry {
		if (!ModelRegistry.instance) {
			ModelRegistry.instance = new ModelRegistry()
		}
		return ModelRegistry.instance
	}

	/** Absolute path to ~/.dline/providers/ */
	get providersDir(): string {
		return path.join(getDlineHomePath(), PROVIDERS_DIR_NAME)
	}

	/** Whether the registry has been initialized. */
	get isInitialized(): boolean {
		return this.initialized
	}

	/**
	 * Register a callback to be invoked when provider JSON files change (fs-watch).
	 * Returns an unsubscribe function.
	 */
	onChange(cb: () => void): () => void {
		this.onChangeCallbacks.push(cb)
		return () => {
			this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb)
		}
	}

	/**
	 * Initialize the registry: load all JSON files and start watching.
	 * Safe to call multiple times — subsequent calls are no-ops.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return

		// Ensure the providers directory exists
		await fs.mkdir(this.providersDir, { recursive: true })

		// Load all existing JSON files
		await this.reload()

		// Start watching for changes
		this.startWatch()

		this.initialized = true
		Logger.log(`[ModelRegistry] Initialized, ${this.cache.size} provider(s) loaded from ${this.providersDir}`)
	}

	/**
	 * Reload all provider configs from disk.
	 */
	async reload(): Promise<void> {
		try {
			const entries = await fs.readdir(this.providersDir)
			const jsonFiles = entries.filter((f) => f.endsWith(".json"))

			for (const fileName of jsonFiles) {
				const providerId = fileName.replace(/\.json$/i, "")
				try {
					const filePath = path.join(this.providersDir, fileName)
					const raw = await fs.readFile(filePath, "utf8")
					const config = parseProviderModelsConfig(providerId, raw)
					this.cache.set(providerId, config)
				} catch (err) {
					Logger.warn(`[ModelRegistry] Failed to parse ${fileName}:`, err)
				}
			}

			// Remove cached entries for deleted files
			const loadedIds = new Set(jsonFiles.map((f) => f.replace(/\.json$/i, "")))
			for (const id of this.cache.keys()) {
				if (!loadedIds.has(id)) {
					this.cache.delete(id)
				}
			}

			this._version++
			Logger.debug(`[ModelRegistry] Reloaded ${this.cache.size} provider(s)`)
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				// Directory doesn't exist yet, that's fine
				return
			}
			Logger.error("[ModelRegistry] Failed to reload provider configs:", err)
		}
	}

	/** Start a filesystem watcher for hot-reload. */
	private startWatch(): void {
		if (this.watcher) return

		try {
			this.watcher = chokidar.watch(this.providersDir, {
				persistent: false,
				ignoreInitial: true,
				awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
			})
			this.watcher.on("add", () => this.debouncedReload())
			this.watcher.on("change", () => this.debouncedReload())
			this.watcher.on("unlink", () => this.debouncedReload())
			this.watcher.on("error", (err) => {
				Logger.warn("[ModelRegistry] Watcher error:", err)
			})
		} catch (err) {
			Logger.warn("[ModelRegistry] Failed to start file watcher:", err)
		}
	}

	private reloadTimer: NodeJS.Timeout | null = null

	private debouncedReload(): void {
		if (this.reloadTimer) clearTimeout(this.reloadTimer)
		this.reloadTimer = setTimeout(async () => {
			this.reloadTimer = null
			await this.reload().catch((err) => Logger.error("[ModelRegistry] Debounced reload failed:", err))
			// Notify all registered callbacks
			this.onChangeCallbacks.forEach((cb) => cb())
		}, 500)
	}

	/** Stop the file watcher and clear state. */
	async dispose(): Promise<void> {
		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
		}
		if (this.reloadTimer) {
			clearTimeout(this.reloadTimer)
			this.reloadTimer = null
		}
		this.cache.clear()
		this.initialized = false
		this.onChangeCallbacks = []
	}

	/**
	 * Get models for a specific provider.
	 */
	getProviderModels(providerId: string): ProviderModelsConfig | undefined {
		if (providerId === "openai") {
			return this.getUnifiedOpenAiConfig()
		}
		return this.cache.get(providerId)
	}

	/** Merge the retired OpenAI Native catalog into the canonical OpenAI provider in memory. */
	private getUnifiedOpenAiConfig(): ProviderModelsConfig | undefined {
		const configured = this.cache.get("openai")
		const legacy = this.cache.get("openai-native")
		if (!configured && !legacy) {
			return undefined
		}

		const seed = getProviderSeedConfig("openai")
		return {
			...(seed ?? legacy ?? configured),
			...legacy,
			...configured,
			provider: "openai",
			providerName: "OpenAI",
			billingMode: configured?.billingMode ?? seed?.billingMode ?? legacy?.billingMode ?? "token",
			models: {
				...(legacy?.models ?? {}),
				...(seed?.models ?? {}),
				...(configured?.models ?? {}),
			},
			defaultModelId: configured?.defaultModelId ?? legacy?.defaultModelId ?? seed?.defaultModelId,
		}
	}

	/**
	 * Get all loaded provider model configurations.
	 */
	getAllProviders(): ProviderModelsConfig[] {
		const providers = Array.from(this.cache.entries())
			.filter(([providerId]) => providerId !== "openai" && providerId !== "openai-native")
			.map(([, config]) => config)
		const openai = this.getUnifiedOpenAiConfig()
		if (openai) providers.push(openai)
		return providers
	}

	/**
	 * Get all models across all providers, grouped by provider.
	 */
	getAllModels(): Array<{
		provider: string
		providerName: string
		models: ModelInfo[]
		defaultModelId?: string
	}> {
		const result: Array<{
			provider: string
			providerName: string
			models: ModelInfo[]
			defaultModelId?: string
		}> = []

		for (const config of this.getAllProviders()) {
			result.push({
				provider: config.provider,
				providerName: config.providerName,
				models: Object.values(config.models),
				defaultModelId: config.defaultModelId,
			})
		}

		return result
	}

	/**
	 * Check if a provider has any models configured.
	 */
	hasProvider(providerId: string): boolean {
		return Object.keys(this.getProviderModels(providerId)?.models ?? {}).length > 0
	}
}
