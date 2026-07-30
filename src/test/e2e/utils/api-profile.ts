import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export type E2EProfileTarget = "auto" | "mock-openai" | "deepseek" | "openai-codex" | "openai-compatible"

export const E2E_PROFILE_NAMES = {
	mockOpenAi: "E2E OpenAI Compatible Mock",
	persistence: "E2E Profile Persistence",
	deepseek: "E2E DeepSeek",
	openAiCodex: "E2E OpenAI Codex",
	openAiCompatible: "E2E OpenAI Compatible",
} as const

interface StoredApiProfile {
	id: string
	name: string
	provider: string
	modelId: string
	usedFor: string[]
	enabled: boolean
	baseUrl?: string
	[key: string]: unknown
}

interface PrepareE2EStateOptions {
	dlineDir: string
	mockBaseUrl: string
	sourceDataDir?: string
	env?: NodeJS.ProcessEnv
}

export interface PreparedE2EState {
	dlineDir: string
	selectedProfileName: string
	profileNames: string[]
}

const PROFILE_IDS = {
	mockOpenAi: "dline-e2e-mock-openai",
	persistence: "dline-e2e-profile-persistence",
	deepseek: "dline-e2e-deepseek",
	openAiCodex: "dline-e2e-openai-codex",
	openAiCompatible: "dline-e2e-openai-compatible",
} as const

const DEFAULT_MODELS = {
	deepseek: "deepseek-v4-flash",
	openAiCodex: "gpt-5.6-sol",
	openAiCompatible: "gpt-5.6-sol",
} as const

function highReasoning() {
	return { enableThinking: true, effort: "high", thinkingBudget: 0 }
}

function value(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const candidate = env[key]?.trim()
	return candidate ? candidate : undefined
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
		throw error
	}
}

async function copyFileIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
	if (!(await pathExists(sourcePath))) return
	await mkdir(path.dirname(destinationPath), { recursive: true })
	await cp(sourcePath, destinationPath)
}

async function copyDirectoryIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
	if (!(await pathExists(sourcePath))) return
	await mkdir(path.dirname(destinationPath), { recursive: true })
	await cp(sourcePath, destinationPath, { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
	if (!(await pathExists(filePath))) return fallback
	return JSON.parse(await readFile(filePath, "utf8")) as T
}

async function writeJson(filePath: string, data: unknown, mode?: number): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode })
}

function upsertProfile(profiles: StoredApiProfile[], profile: StoredApiProfile): void {
	const index = profiles.findIndex((candidate) => candidate.id === profile.id)
	if (index === -1) profiles.push(profile)
	else profiles[index] = profile
}

function openAiProfile(id: string, name: string, baseUrl: string, modelId: string): StoredApiProfile {
	return {
		id,
		name,
		provider: "openai",
		baseUrl,
		modelId,
		usedFor: ["act", "plan", "subagents"],
		enabled: true,
		openai: {
			reasoning: highReasoning(),
			streamIncludeUsage: true,
		},
	}
}

function setApiKey(apiKeys: Record<string, { apiKey: string; name: string }>, profile: StoredApiProfile, apiKey: string): void {
	apiKeys[profile.id] = { apiKey, name: profile.name }
}

function parseProfileTarget(env: NodeJS.ProcessEnv): E2EProfileTarget {
	const target = value(env, "DLINE_E2E_PROFILE") ?? "auto"
	if (["auto", "mock-openai", "deepseek", "openai-codex", "openai-compatible"].includes(target)) {
		return target as E2EProfileTarget
	}
	throw new Error(`Unsupported DLINE_E2E_PROFILE: ${target}`)
}

export function hasLiveProfileCredentials(target: E2EProfileTarget, env: NodeJS.ProcessEnv = process.env): boolean {
	switch (target) {
		case "deepseek":
			return Boolean(value(env, "DLINE_E2E_DEEPSEEK_API_KEY"))
		case "openai-codex":
			return Boolean(value(env, "DLINE_E2E_OPENAI_CODEX_CREDENTIALS_JSON"))
		case "openai-compatible":
			return Boolean(value(env, "DLINE_E2E_OPENAI_COMPATIBLE_API_KEY"))
		default:
			return false
	}
}

/**
 * Build an isolated DLINE_DIR for one Playwright test.
 * Only authentication/profile files are copied from the user's default data directory.
 */
export async function prepareE2EState(options: PrepareE2EStateOptions): Promise<PreparedE2EState> {
	const env = options.env ?? process.env
	const sourceDataDir = options.sourceDataDir ?? path.join(os.homedir(), ".dline", "data")
	const destinationDataDir = path.join(options.dlineDir, "data")
	const settingsDir = path.join(destinationDataDir, "settings")
	const secretsDir = path.join(destinationDataDir, "secrets")

	await mkdir(destinationDataDir, { recursive: true })
	await copyFileIfPresent(path.join(sourceDataDir, "secrets.json"), path.join(destinationDataDir, "secrets.json"))
	await copyDirectoryIfPresent(path.join(sourceDataDir, "secrets"), secretsDir)
	await copyFileIfPresent(
		path.join(sourceDataDir, "settings", "api_profiles.json"),
		path.join(settingsDir, "api_profiles.json"),
	)

	const sourceSettings = await readJson<Record<string, unknown>>(path.join(sourceDataDir, "settings", "settings.json"), {})
	const profilesPath = path.join(settingsDir, "api_profiles.json")
	const profiles = await readJson<StoredApiProfile[]>(profilesPath, [])
	const sourceProfileNames = new Set(profiles.map((profile) => profile.name))
	const apiKeysPath = path.join(secretsDir, "api_keys.json")
	const apiKeys = await readJson<Record<string, { apiKey: string; name: string }>>(apiKeysPath, {})
	const legacySecretsPath = path.join(destinationDataDir, "secrets.json")
	const legacySecrets = await readJson<Record<string, string>>(legacySecretsPath, {})

	const mockProfile = openAiProfile(
		PROFILE_IDS.mockOpenAi,
		E2E_PROFILE_NAMES.mockOpenAi,
		`${options.mockBaseUrl}/v1`,
		"dline-e2e-model",
	)
	upsertProfile(profiles, mockProfile)
	setApiKey(apiKeys, mockProfile, "dline-e2e-api-key")

	const persistenceProfile = openAiProfile(
		PROFILE_IDS.persistence,
		E2E_PROFILE_NAMES.persistence,
		`${options.mockBaseUrl}/v1`,
		"dline-e2e-model",
	)
	upsertProfile(profiles, persistenceProfile)
	setApiKey(apiKeys, persistenceProfile, "dline-e2e-api-key")

	const deepseekApiKey = value(env, "DLINE_E2E_DEEPSEEK_API_KEY")
	if (deepseekApiKey) {
		const profile: StoredApiProfile = {
			id: PROFILE_IDS.deepseek,
			name: E2E_PROFILE_NAMES.deepseek,
			provider: "deepseek",
			modelId: value(env, "DLINE_E2E_DEEPSEEK_MODEL_ID") ?? DEFAULT_MODELS.deepseek,
			usedFor: ["act", "plan", "subagents"],
			enabled: true,
			deepseek: { reasoning: highReasoning() },
		}
		const baseUrl = value(env, "DLINE_E2E_DEEPSEEK_BASE_URL")
		if (baseUrl) profile.baseUrl = baseUrl
		upsertProfile(profiles, profile)
		setApiKey(apiKeys, profile, deepseekApiKey)
	}

	const openAiCompatibleApiKey = value(env, "DLINE_E2E_OPENAI_COMPATIBLE_API_KEY")
	if (openAiCompatibleApiKey) {
		const profile = openAiProfile(
			PROFILE_IDS.openAiCompatible,
			E2E_PROFILE_NAMES.openAiCompatible,
			value(env, "DLINE_E2E_OPENAI_COMPATIBLE_BASE_URL") ?? "https://api.openai.com/v1",
			value(env, "DLINE_E2E_OPENAI_COMPATIBLE_MODEL_ID") ?? DEFAULT_MODELS.openAiCompatible,
		)
		upsertProfile(profiles, profile)
		setApiKey(apiKeys, profile, openAiCompatibleApiKey)
	}

	const codexCredentials = value(env, "DLINE_E2E_OPENAI_CODEX_CREDENTIALS_JSON")
	if (codexCredentials) {
		JSON.parse(codexCredentials)
		upsertProfile(profiles, {
			id: PROFILE_IDS.openAiCodex,
			name: E2E_PROFILE_NAMES.openAiCodex,
			provider: "openai-codex",
			modelId: value(env, "DLINE_E2E_OPENAI_CODEX_MODEL_ID") ?? DEFAULT_MODELS.openAiCodex,
			usedFor: ["act", "plan", "subagents"],
			enabled: true,
			openaiCodex: { reasoning: highReasoning() },
		})
		legacySecrets["openai-codex-oauth-credentials"] = codexCredentials
	}

	const profileTarget = parseProfileTarget(env)
	const targetNames: Record<Exclude<E2EProfileTarget, "auto">, string> = {
		"mock-openai": E2E_PROFILE_NAMES.mockOpenAi,
		deepseek: E2E_PROFILE_NAMES.deepseek,
		"openai-codex": E2E_PROFILE_NAMES.openAiCodex,
		"openai-compatible": E2E_PROFILE_NAMES.openAiCompatible,
	}
	const sourceSelection = [sourceSettings.actModeProfile, sourceSettings.planModeProfile].find(
		(candidate): candidate is string => typeof candidate === "string" && sourceProfileNames.has(candidate),
	)
	const selectedProfileName =
		profileTarget === "auto" ? (sourceSelection ?? E2E_PROFILE_NAMES.mockOpenAi) : targetNames[profileTarget]
	if (!profiles.some((profile) => profile.name === selectedProfileName && profile.enabled)) {
		throw new Error(`Requested E2E profile is unavailable: ${selectedProfileName}`)
	}

	await writeJson(profilesPath, profiles)
	await writeJson(apiKeysPath, apiKeys, 0o600)
	await writeJson(legacySecretsPath, legacySecrets, 0o600)
	await writeJson(path.join(settingsDir, "settings.json"), {
		__settingsMigrationVersion: 1,
		actModeProfile: selectedProfileName,
		planModeProfile: selectedProfileName,
		enableParallelToolCalling: true,
	})
	await writeJson(path.join(destinationDataDir, "globalState.json"), {
		isNewUser: false,
		mode: "act",
		nativeToolCallEnabled: true,
		welcomeViewCompleted: true,
	})

	return {
		dlineDir: options.dlineDir,
		selectedProfileName,
		profileNames: profiles.map((profile) => profile.name),
	}
}
