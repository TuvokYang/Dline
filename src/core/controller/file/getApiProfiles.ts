/**
 * Handler for getApiProfiles RPC.
 *
 * Reads ApiProfile configurations from ~/.dline/data/settings/api_profiles.json.
 */

import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { getDlineDataDir, getDlineHomePath } from "@core/storage/disk"
import { getApiKey, setApiKey } from "@core/storage/secrets"
import { EmptyRequest } from "@shared/proto/dline/common"
import { ApiProfile, ApiProfilesResponse } from "@shared/proto/dline/profile"
import {
	canStoreRegistryModelInfoOverrides,
	getModelInfoOverrideFields,
	mergeModelInfo,
	modelInfoToStorageJson,
	pickModelInfoOverride,
} from "@shared/providers/model-info-overrides"
import { Logger } from "@shared/services/Logger"
import { ProviderToApiKeyMap } from "@shared/storage/provider-keys"
import fsSync from "fs"
import fs from "fs/promises"
import path from "path"
import type { Controller } from ".."

const API_PROFILES_FILE = "api_profiles.json"

let needsCleanRewrite = false
let apiProfilesWriteQueue: Promise<void> = Promise.resolve()
let cleanRewriteInProgress = false
let apiProfilesReadCache:
	| {
			filePath: string
			mtimeMs: number
			size: number
			registryVersion: number
			profiles: ApiProfile[]
	  }
	| undefined

const ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 500]

function isRetryableRenameError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException)?.code
	return code === "EPERM" || code === "EBUSY" || code === "EACCES"
}

async function renameWithRetry(tmpPath: string, filePath: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(tmpPath, filePath)
			return
		} catch (error) {
			if (!isRetryableRenameError(error) || attempt >= ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS.length) {
				throw error
			}
			await new Promise((resolve) => setTimeout(resolve, ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS[attempt]))
		}
	}
}

async function atomicWriteApiProfilesFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.json`
	try {
		await fs.writeFile(tmpPath, data, "utf8")
		await renameWithRetry(tmpPath, filePath)
	} catch (error) {
		fs.unlink(tmpPath).catch(() => {})
		throw error
	}
}

export function writeApiProfilesToFile(filePath: string, profiles: ApiProfile[]): Promise<void> {
	const data = JSON.stringify(serializeApiProfilesForStorage(profiles), null, "\t")
	const write = async () => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await atomicWriteApiProfilesFile(filePath, data)
		apiProfilesReadCache = undefined
	}
	const nextWrite = apiProfilesWriteQueue.then(write, write)
	apiProfilesWriteQueue = nextWrite.catch(() => {})
	return nextWrite
}

function findFirstJsonValueEnd(raw: string): number | undefined {
	let started = false
	let depth = 0
	let inString = false
	let escaped = false

	for (let i = 0; i < raw.length; i++) {
		const char = raw[i]
		if (!started) {
			if (/\s/.test(char)) continue
			if (char !== "[" && char !== "{") return undefined
			started = true
			depth = 1
			continue
		}

		if (inString) {
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
		} else if (char === "[" || char === "{") {
			depth++
		} else if (char === "]" || char === "}") {
			depth--
			if (depth === 0) return i + 1
		}
	}

	return undefined
}

function parseApiProfilesJson(raw: string): { profiles: ApiProfile[]; recovered: boolean } {
	try {
		return { profiles: readProfilesFromJson(JSON.parse(raw)), recovered: false }
	} catch (error) {
		const end = findFirstJsonValueEnd(raw)
		if (end === undefined || raw.slice(end).trim().length === 0) {
			throw error
		}
		const profiles = readProfilesFromJson(JSON.parse(raw.slice(0, end)))
		Logger.warn("[getApiProfiles] Recovered api_profiles.json by trimming trailing invalid JSON")
		return { profiles, recovered: true }
	}
}

function readProfilesFromJson(data: unknown): ApiProfile[] {
	const rawProfiles = Array.isArray(data)
		? data
		: data && typeof data === "object" && Array.isArray((data as any).profiles)
			? (data as any).profiles
			: []
	return rawProfiles.map(normalizeApiProfile)
}

export function normalizeApiProfile(profile: unknown): ApiProfile {
	const normalized = ApiProfile.fromJSON(profile ?? {})
	if (profile && typeof profile === "object") {
		const rawProfile = profile as Record<string, unknown>
		const rawModelInfo = rawProfile.modelInfo ?? rawProfile.model_info
		if (rawModelInfo && typeof rawModelInfo === "object") {
			normalized.modelInfo = rawModelInfo as ApiProfile["modelInfo"]
		}
	}
	return normalized
}

function resolveRegistryModelInfo(profile: ApiProfile) {
	if (!profile.provider || !profile.modelId) {
		return undefined
	}
	const providerModels = ModelRegistry.getInstance().getProviderModels(profile.provider)
	return providerModels?.models?.[profile.modelId]
}

function getProfileModelInfoOverride(profile: ApiProfile) {
	const baseModelInfo = resolveRegistryModelInfo(profile)
	if (!baseModelInfo) {
		return profile.modelInfo
	}
	if (!canStoreRegistryModelInfoOverrides(profile.provider)) {
		return undefined
	}
	return pickModelInfoOverride(profile.modelInfo, baseModelInfo, getModelInfoOverrideFields(profile.provider))
}

function applyRegistryModelInfo(profiles: ApiProfile[]): boolean {
	let changed = false
	for (const profile of profiles) {
		const baseModelInfo = resolveRegistryModelInfo(profile)
		if (!baseModelInfo) {
			// Custom models have no registry entry, so their top-level
			// modelInfo remains the authoritative editable metadata.
			continue
		}
		if (!canStoreRegistryModelInfoOverrides(profile.provider)) {
			// Registry-backed non-override providers store model metadata in
			// provider config or registry data, so stale top-level snapshots
			// must be removed without affecting custom model metadata.
			if (profile.modelInfo) {
				profile.modelInfo = undefined
				changed = true
			}
			continue
		}
		// Override-enabled providers (e.g. openai): merge registry modelInfo
		// with any stored user overrides so the profile always carries an
		// up-to-date snapshot.
		const modelInfoOverride = getProfileModelInfoOverride(profile)
		const mergedModelInfo = mergeModelInfo(baseModelInfo, modelInfoOverride)
		if (JSON.stringify(profile.modelInfo ?? undefined) !== JSON.stringify(mergedModelInfo ?? undefined)) {
			changed = true
		}
		profile.modelInfo = ApiProfile.fromJSON({ modelInfo: mergedModelInfo }).modelInfo
	}
	return changed
}

/** Fill an omitted profile modelId from the provider registry default. */
export function applyRegistryModelDefaults(profiles: ApiProfile[]): boolean {
	const registry = ModelRegistry.getInstance()
	let changed = false
	const usedNames = new Set(profiles.map((profile) => profile.name).filter(Boolean))
	for (const profile of profiles) {
		if (!profile.provider || profile.modelId) continue
		const defaultModelId = registry.getProviderModels(profile.provider)?.defaultModelId
		if (!defaultModelId) continue
		profile.modelId = defaultModelId
		changed = true
		if (!profile.name || profile.name === "New Model") {
			const baseName = `${profile.provider}:${defaultModelId}`
			let name = baseName
			let suffix = 2
			while (usedNames.has(name)) name = `${baseName} (${suffix++})`
			profile.name = name
			usedNames.add(name)
		}
	}
	return changed
}

async function hydrateModelInfoFromRegistry(profiles: ApiProfile[]): Promise<boolean> {
	const registry = ModelRegistry.getInstance()
	if (!registry.isInitialized) {
		await registry.reload()
	}
	const defaultsChanged = applyRegistryModelDefaults(profiles)
	return applyRegistryModelInfo(profiles) || defaultsChanged
}

export function serializeApiProfilesForStorage(profiles: ApiProfile[]): unknown[] {
	return profiles.map((profile) => {
		const modelInfo = getProfileModelInfoOverride(profile)
		const serialized = ApiProfile.toJSON({ ...profile, apiKey: "", modelInfo: undefined }) as Record<string, unknown>
		delete serialized.apiKey
		delete serialized.api_key
		delete serialized.model_info
		const modelInfoJson = modelInfoToStorageJson(modelInfo)
		if (modelInfoJson) {
			serialized.modelInfo = modelInfoJson
		} else {
			delete serialized.modelInfo
		}
		return serialized
	})
}

function hydrateApiKeys(profiles: ApiProfile[]): void {
	for (const profile of profiles) {
		if (profile.apiKey) {
			const stored = getApiKey(profile.id)
			if (!stored || stored !== profile.apiKey) {
				setApiKey(profile.id, profile.apiKey, profile.name)
				needsCleanRewrite = true
			}
			continue
		}

		const storedKey = getApiKey(profile.id)
		if (storedKey) {
			profile.apiKey = storedKey
		}
	}
}

async function cleanRewriteApiProfiles(profiles: ApiProfile[]): Promise<void> {
	// Debounce guard: prevent concurrent clean rewrites from piling up
	// when readApiProfiles() (sync, fire-and-forget) triggers multiple
	// async writes before the first one completes.
	if (cleanRewriteInProgress) {
		return
	}
	cleanRewriteInProgress = true
	const settingsDir = path.join(getDlineDataDir(), "settings")
	const filePath = path.join(settingsDir, API_PROFILES_FILE)
	try {
		await writeApiProfilesToFile(filePath, profiles)
		Logger.log("[cleanRewriteApiProfiles] Stripped apiKey fields from api_profiles.json")
	} catch (err) {
		Logger.error("[cleanRewriteApiProfiles] Failed:", err)
	} finally {
		cleanRewriteInProgress = false
	}
}

/**
 * Get all saved ApiProfiles.
 * Auto-initializes from apiConfiguration if no saved data exists.
 */
export async function getApiProfiles(controller: Controller, _request: EmptyRequest): Promise<ApiProfilesResponse> {
	const settingsDir = path.join(getDlineDataDir(), "settings")
	const filePath = path.join(settingsDir, API_PROFILES_FILE)

	try {
		const raw = await fs.readFile(filePath, "utf8")
		const parsed = parseApiProfilesJson(raw)
		const profiles = parsed.profiles
		hydrateApiKeys(profiles)
		const modelInfoChanged = await hydrateModelInfoFromRegistry(profiles)
		if (parsed.recovered) {
			needsCleanRewrite = false
			await writeApiProfilesToFile(filePath, profiles)
		} else if (needsCleanRewrite || modelInfoChanged) {
			needsCleanRewrite = false
			await cleanRewriteApiProfiles(profiles)
		}
		// Flush any pending globalState writes before ensureProfileDefaults
		// reads planModeProfile/actModeProfile, so it sees the latest values
		// and doesn't incorrectly reset to the provider default.
		await controller.stateManager.flushPendingState()
		const defaultsChanged = ensureProfileDefaults(controller, profiles)
		// Only post state to webview if defaults actually changed (Bug fix:
		// posting on every read causes excessive webview re-renders and
		// contributes to updateApiProfiles call storms).
		if (defaultsChanged) {
			await controller.postStateToWebview()
		}
		return ApiProfilesResponse.create({ profiles })
	} catch (err: any) {
		if (err.code === "ENOENT") {
			// Try migration from providers first, then fall back to legacy config
			let profiles = await migrateFromProviders(controller)
			Logger.log(`[getApiProfiles] migrateFromProviders returned ${profiles.length} profiles`)
			if (profiles.length === 0) {
				profiles = initializeFromApiConfig(controller)
				Logger.log(`[getApiProfiles] initializeFromApiConfig returned ${profiles.length} profiles`)
			}
			await hydrateModelInfoFromRegistry(profiles)
			await saveProfilesToFile(filePath, profiles)
			// Flush any pending globalState writes before ensureProfileDefaults
			// reads planModeProfile/actModeProfile, so it sees the latest values
			// and doesn't incorrectly reset to the provider default.
			await controller.stateManager.flushPendingState()
			ensureProfileDefaults(controller, profiles)
			// Always post on first initialization so webview picks up defaults
			await controller.postStateToWebview()
			return ApiProfilesResponse.create({ profiles })
		}
		Logger.error("[getApiProfiles] Failed to read api_profiles.json:", err)
		throw err
	}
}

/**
 * Ensure planModeProfile and actModeProfile are set to valid profile names.
 * Reads providers.json lastUsedProvider as the default when no profile is set.
 * Falls back to first matching profile if the stored profile no longer exists.
 *
 * @returns true if any global state was modified (profiles defaults were set)
 */
function ensureProfileDefaults(controller: Controller, profiles: ApiProfile[]): boolean {
	const apiConfig = controller.stateManager.getApiConfiguration()
	const planExists = !!(apiConfig.planModeProfile && profiles.some((p) => p.name === apiConfig.planModeProfile))
	const actExists = !!(apiConfig.actModeProfile && profiles.some((p) => p.name === apiConfig.actModeProfile))
	Logger.debug("[ensureProfileDefaults]", {
		plan: apiConfig.planModeProfile,
		planExists,
		act: apiConfig.actModeProfile,
		actExists,
		profileCount: profiles.length,
	})

	// Read lastUsedProvider from providers.json as migration default
	let lastUsedProvider: string | undefined
	try {
		const providersPath = path.join(getDlineDataDir(), "settings", "providers.json")
		if (fsSync.existsSync(providersPath)) {
			const raw = fsSync.readFileSync(providersPath, "utf8")
			const data = JSON.parse(raw)
			lastUsedProvider = data?.lastUsedProvider as string | undefined
		}
	} catch {
		// providers.json may not exist or be malformed
	}

	let changed = false

	if (!planExists) {
		// Prefer lastUsedProvider if available
		const planProfile = lastUsedProvider
			? profiles.find((p) => p.provider === lastUsedProvider && p.usedFor.includes("plan"))
			: undefined
		const fallback = planProfile || profiles.find((p) => p.usedFor.includes("plan"))
		if (fallback) {
			controller.stateManager.setGlobalState("planModeProfile", fallback.name)
			changed = true
		}
	}
	if (!actExists) {
		const actProfile = lastUsedProvider
			? profiles.find((p) => p.provider === lastUsedProvider && p.usedFor.includes("act"))
			: undefined
		const fallback = actProfile || profiles.find((p) => p.usedFor.includes("act"))
		if (fallback) {
			controller.stateManager.setGlobalState("actModeProfile", fallback.name)
			changed = true
		}
	}

	return changed
}

/**
 * Migrate provider model configs from ~/.dline/providers/*.json into ApiProfiles.
 * Also migrates legacy API keys from flat secrets to the new ApiKeyStore.
 * Only runs when api_profiles.json does not exist.
 */
async function migrateFromProviders(controller: Controller): Promise<ApiProfile[]> {
	const providersDir = path.join(getDlineHomePath(), "providers")
	if (!fsSync.existsSync(providersDir)) return []

	const files = fsSync.readdirSync(providersDir).filter((f) => f.endsWith(".json"))
	if (files.length === 0) return []

	const stateManager = controller.stateManager
	const profiles: ApiProfile[] = []

	for (const file of files) {
		const providerId = path.basename(file, ".json")
		let config: { provider: string; defaultModelId?: string; models: Record<string, unknown> }
		try {
			const raw = fsSync.readFileSync(path.join(providersDir, file), "utf8")
			config = JSON.parse(raw)
		} catch {
			Logger.warn(`[migrateFromProviders] Skipping invalid JSON: ${file}`)
			continue
		}

		if (!config.models || typeof config.models !== "object" || Object.keys(config.models).length === 0) continue

		const providerName = config.provider || providerId

		// Only migrate providers that have an API key in legacy flat secrets
		const secretFields = ProviderToApiKeyMap[providerName as keyof typeof ProviderToApiKeyMap]
		if (!secretFields) continue

		const fields = Array.isArray(secretFields) ? secretFields : [secretFields]
		const keyParts: string[] = []

		for (const field of fields) {
			try {
				const val = stateManager.getSecretKey(field as any)
				if (!val) continue
				// JSON credentials (e.g. openai-codex-oauth-credentials) — keep as serialized string
				if (typeof val === "object") {
					keyParts.push(JSON.stringify(val))
				} else if (typeof val === "string" && val.length > 0) {
					keyParts.push(val)
				}
			} catch {
				// Secret key not found — skip this field
			}
		}

		const combinedKey = keyParts.join("|")
		if (!combinedKey) continue

		const modelId = config.defaultModelId || Object.keys(config.models)[0]
		const profileId = crypto.randomUUID()

		profiles.push(
			ApiProfile.create({
				id: profileId,
				name: `${providerName}:${modelId}`,
				provider: providerName,
				apiKey: combinedKey,
				modelId,
				usedFor: ["act", "plan", "subagents"],
				enabled: true,
			}),
		)

		// Migrate API key to new ApiKeyStore
		setApiKey(profileId, combinedKey, providerName)
		Logger.log(`[migrateFromProviders] Migrated API key for ${providerName}`)
	}

	return profiles
}

/**
 * @deprecated Use ensureProfileDefaults and profile-driven model selection instead.
 * Reads legacy apiConfiguration via StateManager to create initial ApiProfiles.
 */
function initializeFromApiConfig(controller: Controller): ApiProfile[] {
	const config = controller.stateManager.getApiConfiguration() as Record<string, unknown> | undefined
	if (!config) return []
	const profiles: ApiProfile[] = []
	const modes = [
		{ mode: "plan", prefix: "planMode" },
		{ mode: "act", prefix: "actMode" },
	]
	for (const { mode, prefix } of modes) {
		const provider = config[`${prefix}ApiProvider`]
		const modelId = config[`${prefix}ApiModelId`]
		if (provider && modelId) {
			profiles.push(
				ApiProfile.create({
					id: crypto.randomUUID(),
					name: `${provider}:${modelId}`,
					provider: String(provider),
					apiKey: "",
					modelId: String(modelId),
					usedFor: [mode],
					enabled: true,
				}),
			)
		}
	}
	return profiles
}

/**
 * Synchronously read ApiProfiles from disk.
 * Backfills apiKey from ApiKeyStore for each profile.
 * Returns empty array on any error.
 */
export function readApiProfiles(): ApiProfile[] {
	const settingsDir = path.join(getDlineDataDir(), "settings")
	const filePath = path.join(settingsDir, API_PROFILES_FILE)
	try {
		const stat = fsSync.statSync(filePath)
		const registryVersion = ModelRegistry.getInstance().version
		if (
			apiProfilesReadCache?.filePath === filePath &&
			apiProfilesReadCache.mtimeMs === stat.mtimeMs &&
			apiProfilesReadCache.size === stat.size &&
			apiProfilesReadCache.registryVersion === registryVersion
		) {
			return apiProfilesReadCache.profiles
		}
		const raw = fsSync.readFileSync(filePath, "utf8")
		const parsed = parseApiProfilesJson(raw)
		const profiles = parsed.profiles
		hydrateApiKeys(profiles)
		const defaultsChanged = applyRegistryModelDefaults(profiles)
		const modelInfoChanged = applyRegistryModelInfo(profiles) || defaultsChanged
		if (parsed.recovered || needsCleanRewrite) {
			needsCleanRewrite = false
			cleanRewriteApiProfiles(profiles)
		} else if (modelInfoChanged) {
			cleanRewriteApiProfiles(profiles)
		}
		apiProfilesReadCache = {
			filePath,
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			registryVersion,
			profiles,
		}
		return profiles
	} catch {
		if (apiProfilesReadCache?.filePath === filePath) {
			apiProfilesReadCache = undefined
		}
		return []
	}
}

/**
 * Find enabled profiles for a given provider.
 * Used by refresh functions and initializeWebview to locate profiles
 * with valid apiKeys before making model-list API calls.
 */
export function findEnabledProfiles(provider: string): ApiProfile[] {
	return readApiProfiles().filter((p) => p.provider === provider && p.enabled)
}

export function findEnabledProfileByName(profileName?: string): ApiProfile | undefined {
	if (!profileName) return undefined
	// enabled flag indicates "configured", not "selected".
	// Always find by name regardless of enabled status — the selection
	// is tracked via planModeProfile/actModeProfile in globalState.
	return readApiProfiles().find((p) => p.name === profileName)
}

/**
 * Write profiles array to api_profiles.json.
 */
async function saveProfilesToFile(filePath: string, profiles: ApiProfile[]): Promise<void> {
	try {
		await writeApiProfilesToFile(filePath, profiles)
		Logger.log(`[getApiProfiles] Initialized api_profiles.json with ${profiles.length} profile(s)`)
	} catch (err) {
		Logger.error("[getApiProfiles] Failed to write api_profiles.json:", err)
	}
}

/**
 * Map of provider name to its primary API key field name.
 * Used by updateApiConfiguration and StateManager to bridge apiKey fields
 * with the profile-based key storage.
 */
export const PROVIDER_API_KEY_MAP: Record<string, string> = (() => {
	const map: Record<string, string> = {}
	for (const [provider, field] of Object.entries(ProviderToApiKeyMap)) {
		map[provider] = Array.isArray(field) ? field[0] : field
	}
	return map
})()

export { saveProfilesToFile }
