/**
 * Handler for getApiProfiles RPC.
 *
 * Reads ApiProfile configurations from ~/.dline/data/settings/api_profiles.json.
 */

import { anthropicModels } from "@core/api/providers/models/anthropic"
import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { recordProfileCatalogBaseline } from "@core/profiles/profile-catalog-state"
import { getDlineDataDir, getDlineHomePath } from "@core/storage/disk"
import {
	getAllProviderSecrets,
	getApiKey,
	getProviderSecret,
	type ProviderSecretEntry,
	reloadApiKeyStore,
	reloadProviderSecretStore,
	setApiKey,
	setProviderSecretsBatch,
} from "@core/storage/secrets"
import { EmptyRequest } from "@shared/proto/dline/common"
import { ApiProfile, ApiProfilesResponse } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { BedrockProviderConfig } from "@shared/proto/dline/provider/bedrock"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { SapAiCoreProviderConfig } from "@shared/proto/dline/provider/sapaicore"
import { openAiEndpointToApiFormat } from "@shared/providers/api-format"
import { updateSelectedContextWindow } from "@shared/providers/effective-model-info"
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
/**
 * Registry-derived modelInfo drift is repaired on disk at most once per process.
 *
 * `getApiProfiles` is a read RPC served by every Controller (sidebar and each
 * editor panel). Writing on every read created a self-sustaining storm: the write
 * woke the Catalog watcher, the watcher advanced the Catalog revision, every
 * Webview reloaded, and each reload wrote again. With several panels open the
 * amplification kept `api_profiles.json` from ever reaching the watcher's write
 * stability window, so newly opened panels stayed on "Loading profiles…"
 * regardless of how small the file was.
 */
let registryModelInfoRepairedPaths = new Set<string>()

/** Reset the process-local registry repair gate. Test-only seam. */
export function resetRegistryModelInfoRepairGateForTest(): void {
	registryModelInfoRepairedPaths = new Set<string>()
}
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
	const write = async () => {
		await persistProviderSecrets(profiles)
		const data = JSON.stringify(serializeApiProfilesForStorage(profiles), null, "\t")
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
	let migrated = false
	if (profile && typeof profile === "object") {
		const rawProfile = profile as Record<string, unknown>
		if (!Object.hasOwn(rawProfile, "enabled")) {
			normalized.enabled = true
			migrated = true
		}
		const rawModelInfo = rawProfile.modelInfo ?? rawProfile.model_info
		if (rawModelInfo && typeof rawModelInfo === "object") {
			normalized.modelInfo = rawModelInfo as ApiProfile["modelInfo"]
		}
	}

	if (normalized.provider === "anthropic" && normalized.modelId) {
		const migratedModelId = normalized.modelId.endsWith(":1m:fast")
			? `${normalized.modelId.slice(0, -":1m:fast".length)}:fast`
			: normalized.modelId.endsWith(":1m")
				? normalized.modelId.slice(0, -":1m".length)
				: undefined

		if (migratedModelId && anthropicModels[migratedModelId]) {
			normalized.modelId = migratedModelId
			normalized.anthropic = AnthropicProviderConfig.create({
				...normalized.anthropic,
				enableLongContext: true,
			})
			migrated = true
		}

		const registryCapabilities = anthropicModels[normalized.modelId]?.capabilities
		const anthropic = normalized.anthropic ?? AnthropicProviderConfig.create()
		const providerCapabilities = anthropic.capabilities
		const contextWindowTiers = providerCapabilities?.contextWindowTiers?.length
			? providerCapabilities.contextWindowTiers
			: registryCapabilities?.contextWindowTiers
		const legacyContextWindow = providerCapabilities?.contextWindow
		if (
			registryCapabilities &&
			!registryCapabilities.contextWindowTiers?.length &&
			providerCapabilities?.contextWindowTiers?.length
		) {
			const { contextWindowTiers: _staleTiers, ...remainingCapabilities } = providerCapabilities
			normalized.anthropic = AnthropicProviderConfig.create({
				...anthropic,
				capabilities: remainingCapabilities,
			})
			migrated = true
		} else if (contextWindowTiers?.length && legacyContextWindow !== undefined) {
			normalized.anthropic = AnthropicProviderConfig.create({
				...anthropic,
				capabilities: updateSelectedContextWindow(
					registryCapabilities,
					anthropic.capabilities,
					anthropic.enableLongContext !== false,
					legacyContextWindow,
				),
			})
			migrated = true
		}
	}

	const openai = normalized.openai
	if (openai && openai.apiFormat === undefined) {
		const legacyApiFormat = openAiEndpointToApiFormat(openai.apiEndpoint)
		if (legacyApiFormat !== undefined) {
			normalized.openai = OpenAiProviderConfig.create({
				...openai,
				apiEndpoint: undefined,
				apiFormat: legacyApiFormat,
			})
			migrated = true
		}
	}

	if (migrated) {
		needsCleanRewrite = true
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
			// Registry-backed non-override providers expose derived metadata to
			// runtime consumers without persisting a stale Profile snapshot.
			if (profile.modelInfo) changed = true
			profile.modelInfo = ApiProfile.fromJSON({ modelInfo: baseModelInfo }).modelInfo
			continue
		}
		// Override-enabled providers (e.g. openai): merge registry modelInfo
		// with any stored user overrides so the profile always carries an
		// up-to-date snapshot.
		const modelInfoOverride = getProfileModelInfoOverride(profile)
		const mergedModelInfo = mergeModelInfo(baseModelInfo, modelInfoOverride)
		const storedModelInfo = modelInfoToStorageJson(profile.modelInfo)
		const normalizedOverride = modelInfoToStorageJson(modelInfoOverride)
		if (JSON.stringify(storedModelInfo) !== JSON.stringify(normalizedOverride)) {
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
		const sanitized = stripEmbeddedProviderSecrets(profile)
		const serialized = ApiProfile.toJSON({ ...sanitized, apiKey: "", modelInfo: undefined }) as Record<string, unknown>
		serialized.enabled = sanitized.enabled
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

function collectProviderSecrets(profile: ApiProfile): ProviderSecretEntry | undefined {
	const secrets: Record<string, string> = {}
	if (profile.bedrock) {
		for (const field of ["awsAccessKey", "awsSecretKey", "awsSessionToken", "awsBedrockApiKey"] as const) {
			const value = profile.bedrock[field]
			if (value) secrets[field] = value
		}
	}
	if (profile.sapaicore?.clientSecret) secrets.clientSecret = profile.sapaicore.clientSecret
	if (Object.keys(secrets).length === 0) return undefined
	return { name: profile.name, provider: profile.provider, secrets }
}

function stripEmbeddedProviderSecrets(profile: ApiProfile): ApiProfile {
	return {
		...profile,
		bedrock: profile.bedrock
			? {
					...profile.bedrock,
					awsAccessKey: "",
					awsSecretKey: "",
					awsSessionToken: "",
					awsBedrockApiKey: "",
				}
			: undefined,
		sapaicore: profile.sapaicore ? { ...profile.sapaicore, clientSecret: "" } : undefined,
	}
}

async function persistProviderSecrets(profiles: ApiProfile[]): Promise<void> {
	const changes: Record<string, ProviderSecretEntry | undefined> = {}
	const profileIds = new Set(profiles.map((profile) => profile.id))
	for (const id of Object.keys(getAllProviderSecrets())) {
		if (!profileIds.has(id)) changes[id] = undefined
	}
	for (const profile of profiles) changes[profile.id] = collectProviderSecrets(profile)
	await setProviderSecretsBatch(changes)
}

function hydrateProviderSecrets(profiles: ApiProfile[]): void {
	for (const profile of profiles) {
		const embedded = collectProviderSecrets(profile)
		const stored = getProviderSecret(profile.id)
		const secrets = { ...stored?.secrets, ...embedded?.secrets }
		if (Object.keys(secrets).length === 0) continue

		if (profile.provider === "bedrock" || profile.bedrock) {
			const bedrock = profile.bedrock ?? BedrockProviderConfig.create()
			profile.bedrock = {
				...bedrock,
				awsAccessKey: secrets.awsAccessKey ?? bedrock.awsAccessKey,
				awsSecretKey: secrets.awsSecretKey ?? bedrock.awsSecretKey,
				awsSessionToken: secrets.awsSessionToken ?? bedrock.awsSessionToken,
				awsBedrockApiKey: secrets.awsBedrockApiKey ?? bedrock.awsBedrockApiKey,
			}
		}
		if (profile.provider === "sapaicore" || profile.sapaicore) {
			const sapaicore = profile.sapaicore ?? SapAiCoreProviderConfig.create()
			profile.sapaicore = { ...sapaicore, clientSecret: secrets.clientSecret ?? sapaicore.clientSecret }
		}

		if (embedded) {
			void setProviderSecretsBatch({
				[profile.id]: { name: profile.name, provider: profile.provider, secrets },
			})
			needsCleanRewrite = true
		}
	}
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
		hydrateProviderSecrets(profiles)
		const modelInfoChanged = await hydrateModelInfoFromRegistry(profiles)
		if (parsed.recovered) {
			// Recovered JSON is genuinely damaged on disk and must be repaired now.
			needsCleanRewrite = false
			registryModelInfoRepairedPaths.add(filePath)
			await writeApiProfilesToFile(filePath, profiles)
		} else if (needsCleanRewrite) {
			// An embedded secret was migrated into the secret store; the stripped
			// Catalog must be persisted exactly once.
			needsCleanRewrite = false
			registryModelInfoRepairedPaths.add(filePath)
			await cleanRewriteApiProfiles(profiles)
		} else if (modelInfoChanged && !registryModelInfoRepairedPaths.has(filePath)) {
			// Registry drift only needs to reach disk once per process. Every later
			// read serves the hydrated in-memory Catalog without waking the watcher.
			registryModelInfoRepairedPaths.add(filePath)
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
			await controller.stateManager.flushPendingState()
			await controller.postStateToWebview()
		}
		recordProfileCatalogBaseline(controller, profiles)
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
			if (ensureProfileDefaults(controller, profiles)) {
				await controller.stateManager.flushPendingState()
			}
			// Always post on first initialization so webview picks up defaults
			await controller.postStateToWebview()
			recordProfileCatalogBaseline(controller, profiles)
			return ApiProfilesResponse.create({ profiles })
		}
		Logger.error("[getApiProfiles] Failed to read api_profiles.json:", err)
		throw err
	}
}

/**
 * Initialize an absent global Profile binding or migrate one unique legacy name.
 * Explicit missing IDs, missing names, and ambiguous legacy names remain unchanged
 * so Task admission can fail closed instead of silently selecting a fallback.
 */
function ensureProfileDefaults(controller: Controller, profiles: ApiProfile[]): boolean {
	const apiConfig = controller.stateManager.getApiConfiguration()

	let lastUsedProvider: string | undefined
	try {
		const providersPath = path.join(getDlineDataDir(), "settings", "providers.json")
		if (fsSync.existsSync(providersPath)) {
			const raw = fsSync.readFileSync(providersPath, "utf8")
			const data = JSON.parse(raw)
			lastUsedProvider = data?.lastUsedProvider as string | undefined
		}
	} catch {
		// providers.json may not exist or be malformed.
	}

	const reconcileMode = (mode: "plan" | "act"): boolean => {
		const idKey = mode === "plan" ? "planModeProfileId" : "actModeProfileId"
		const nameKey = mode === "plan" ? "planModeProfile" : "actModeProfile"
		const profileId = apiConfig[idKey]
		const profileName = apiConfig[nameKey]

		if (profileId) {
			const profile = profiles.find((candidate) => candidate.id === profileId)
			if (!profile || profile.name === profileName) return false
			controller.stateManager.setGlobalState(idKey, profile.id)
			controller.stateManager.setGlobalState(nameKey, profile.name)
			return true
		}

		if (profileName) {
			const matches = profiles.filter((candidate) => candidate.name === profileName)
			if (matches.length !== 1) return false
			controller.stateManager.setGlobalState(idKey, matches[0].id)
			controller.stateManager.setGlobalState(nameKey, matches[0].name)
			return true
		}

		const matchingProvider = lastUsedProvider
			? profiles.find(
					(candidate) =>
						candidate.enabled && candidate.provider === lastUsedProvider && candidate.usedFor.includes(mode),
				)
			: undefined
		const initial = matchingProvider ?? profiles.find((candidate) => candidate.enabled && candidate.usedFor.includes(mode))
		if (!initial) return false
		controller.stateManager.setGlobalState(idKey, initial.id)
		controller.stateManager.setGlobalState(nameKey, initial.name)
		return true
	}

	const planChanged = reconcileMode("plan")
	const actChanged = reconcileMode("act")
	return planChanged || actChanged
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

		const legacyProviderName = config.provider || providerId
		const providerName = legacyProviderName

		// Only migrate providers that have an API key in legacy flat secrets
		const secretFields = ProviderToApiKeyMap[legacyProviderName as keyof typeof ProviderToApiKeyMap]
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

/** Read the latest persisted Catalog without consulting or updating the process cache. */
export async function readApiProfilesFresh(): Promise<ApiProfile[]> {
	const filePath = path.join(getDlineDataDir(), "settings", API_PROFILES_FILE)
	try {
		const raw = await fs.readFile(filePath, "utf8")
		const profiles = parseApiProfilesJson(raw).profiles
		reloadApiKeyStore()
		reloadProviderSecretStore()
		hydrateApiKeys(profiles)
		hydrateProviderSecrets(profiles)
		applyRegistryModelDefaults(profiles)
		applyRegistryModelInfo(profiles)
		return profiles
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
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
		hydrateProviderSecrets(profiles)
		const defaultsChanged = applyRegistryModelDefaults(profiles)
		const modelInfoChanged = applyRegistryModelInfo(profiles) || defaultsChanged
		if (parsed.recovered || needsCleanRewrite) {
			needsCleanRewrite = false
			registryModelInfoRepairedPaths.add(filePath)
			cleanRewriteApiProfiles(profiles)
		} else if (modelInfoChanged && !registryModelInfoRepairedPaths.has(filePath)) {
			// This synchronous reader runs on hot paths such as findEnabledProfiles and
			// profile-reference resolution. Rewriting on every call re-triggered the
			// Catalog watcher and starved newly opened panels of a settled Catalog.
			registryModelInfoRepairedPaths.add(filePath)
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
	return readApiProfiles().filter((p) => p.provider === provider && p.enabled !== false)
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
