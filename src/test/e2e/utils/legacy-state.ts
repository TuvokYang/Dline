import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"

export const LEGACY_OPENAI_PROFILE_ID = "dline-e2e-legacy-openai-native"
export const LEGACY_OPENAI_PROFILE_NAME = "Legacy OpenAI Native"
export const LEGACY_COMPATIBLE_PROFILE_ID = "dline-e2e-legacy-openai-compatible"
export const LEGACY_COMPATIBLE_PROFILE_NAME = "Legacy OpenAI Compatible"
export const LEGACY_TASK_ID = "dline-e2e-legacy-completed-task"
export const LEGACY_TASK_TEXT = "E2E legacy task survives in-place upgrades"
export const LEGACY_COMPLETION_TEXT = "E2E_LEGACY_TASK_COMPLETED"

const CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
const LEGACY_SEED_VERSION = "pre-jsonl-openai-consolidation-v1"
const LEGACY_TIMESTAMP = Date.UTC(2025, 0, 15, 12, 0, 0)
const FAKE_LEGACY_API_KEY = "sk-dline-e2e-legacy-fake"

export interface LegacyE2EPaths {
	dlineDir: string
	dlineDocsDir: string
	workspaceDir: string
	markerPath: string
}

interface LegacyFixtureMarker {
	fixture: "dline-e2e-legacy-upgrade"
	seedVersion: string
	seededAt: string
	lastValidatedAt?: string
	lastValidatedVersion?: string
}

const paths: LegacyE2EPaths = {
	dlineDir: path.join(CODEBASE_ROOT_DIR, "tmp", ".dline-e2e-legacy"),
	dlineDocsDir: path.join(CODEBASE_ROOT_DIR, "tmp", "dline-e2e-legacy"),
	workspaceDir: path.join(CODEBASE_ROOT_DIR, "tmp", "dline-e2e-legacy", "workspace"),
	markerPath: path.join(CODEBASE_ROOT_DIR, "tmp", "dline-e2e-legacy", ".legacy-fixture.json"),
}

let preparation: Promise<LegacyE2EPaths> | undefined

async function exists(filePath: string): Promise<boolean> {
	return access(filePath)
		.then(() => true)
		.catch(() => false)
}

async function hasEntries(directory: string): Promise<boolean> {
	try {
		return (await readdir(directory)).length > 0
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
		throw error
	}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function readMarker(): Promise<LegacyFixtureMarker> {
	const marker = JSON.parse(await readFile(paths.markerPath, "utf8")) as LegacyFixtureMarker
	if (marker.fixture !== "dline-e2e-legacy-upgrade" || marker.seedVersion !== LEGACY_SEED_VERSION) {
		throw new Error(`Unsupported legacy E2E fixture marker at ${paths.markerPath}`)
	}
	return marker
}

async function seedLegacyFixture(): Promise<void> {
	if ((await hasEntries(paths.dlineDir)) || (await hasEntries(paths.dlineDocsDir))) {
		throw new Error(
			`Legacy E2E storage exists without a valid marker. Preserve it for diagnosis or remove it explicitly: ${paths.dlineDir}, ${paths.dlineDocsDir}`,
		)
	}

	const dataDir = path.join(paths.dlineDir, "data")
	const settingsDir = path.join(dataDir, "settings")
	const providersDir = path.join(paths.dlineDir, "providers")
	const tasksDir = path.join(paths.dlineDocsDir, "tasks")
	const taskDir = path.join(tasksDir, LEGACY_TASK_ID)

	await Promise.all([
		mkdir(settingsDir, { recursive: true }),
		mkdir(providersDir, { recursive: true }),
		mkdir(taskDir, { recursive: true }),
		mkdir(paths.workspaceDir, { recursive: true }),
	])

	await Promise.all([
		writeFile(path.join(paths.workspaceDir, "README.md"), "# Persistent Dline legacy-upgrade E2E workspace\n", "utf8"),
		writeJson(path.join(settingsDir, "api_profiles.json"), [
			{
				id: LEGACY_OPENAI_PROFILE_ID,
				name: LEGACY_OPENAI_PROFILE_NAME,
				provider: "openai-native",
				modelId: "gpt-5.4-mini",
				baseUrl: "https://api.openai.com/v1",
				apiKey: FAKE_LEGACY_API_KEY,
				usedFor: ["act", "plan", "subagents"],
				enabled: true,
				openaiNative: {
					apiFormat: "OPENAI_RESPONSES",
					serviceTier: "default",
					reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 },
				},
			},
			{
				id: LEGACY_COMPATIBLE_PROFILE_ID,
				name: LEGACY_COMPATIBLE_PROFILE_NAME,
				provider: "openai",
				modelId: "legacy-compatible-model",
				baseUrl: "https://legacy.invalid/v1",
				apiKey: `${FAKE_LEGACY_API_KEY}-compatible`,
				usedFor: ["act", "plan"],
				enabled: true,
				openai: {
					apiEndpoint: "chat_completions",
					customModelEnabled: true,
				},
			},
		]),
		writeJson(path.join(dataDir, "globalState.json"), {
			isNewUser: false,
			welcomeViewCompleted: true,
			mode: "act",
			planModeProfile: LEGACY_OPENAI_PROFILE_NAME,
			actModeProfile: LEGACY_OPENAI_PROFILE_NAME,
			enableParallelToolCalling: true,
			nativeToolCallEnabled: true,
		}),
		writeJson(path.join(providersDir, "openai-native.json"), {
			provider: "openai-native",
			providerName: "OpenAI Native (Legacy)",
			defaultModelId: "gpt-5.4-mini",
			billingMode: "token",
			models: {
				"gpt-5.4-mini": {
					id: "gpt-5.4-mini",
					name: "GPT-5.4 mini legacy metadata",
					capabilities: {
						maxTokens: 8192,
						contextWindow: 128000,
						supportsImages: true,
						supportsPromptCache: true,
						supportsTools: true,
					},
					pricing: { inputPrice: 0, outputPrice: 0 },
				},
			},
		}),
		writeJson(path.join(tasksDir, "taskHistory.json"), [
			{
				id: LEGACY_TASK_ID,
				ts: LEGACY_TIMESTAMP,
				task: LEGACY_TASK_TEXT,
				tokensIn: 1200,
				tokensOut: 300,
				totalCost: 0,
				modelId: "gpt-5.4-mini",
				providerId: "openai-native",
				mode: "act",
				cwdOnTaskInitialization: paths.workspaceDir,
			},
		]),
		writeJson(path.join(taskDir, "ui_messages.json"), [
			{ ts: LEGACY_TIMESTAMP, type: "say", say: "task", text: LEGACY_TASK_TEXT },
			{ ts: LEGACY_TIMESTAMP + 1, type: "say", say: "text", text: "Legacy persisted assistant response" },
			{ ts: LEGACY_TIMESTAMP + 2, type: "say", say: "completion_result", text: LEGACY_COMPLETION_TEXT },
		]),
		writeJson(path.join(taskDir, "api_conversation_history.json"), [
			{ role: "user", content: [{ type: "text", text: LEGACY_TASK_TEXT }], ts: LEGACY_TIMESTAMP },
			{
				role: "assistant",
				content: [{ type: "text", text: LEGACY_COMPLETION_TEXT }],
				ts: LEGACY_TIMESTAMP + 1,
			},
		]),
	])

	await writeJson(paths.markerPath, {
		fixture: "dline-e2e-legacy-upgrade",
		seedVersion: LEGACY_SEED_VERSION,
		seededAt: new Date().toISOString(),
	} satisfies LegacyFixtureMarker)
}

export function ensureLegacyE2EFixture(): Promise<LegacyE2EPaths> {
	preparation ??= (async () => {
		if (await exists(paths.markerPath)) {
			await readMarker()
		} else {
			await seedLegacyFixture()
		}
		return paths
	})()
	return preparation
}

export async function recordLegacyE2EValidation(version: string): Promise<void> {
	const marker = await readMarker()
	await writeJson(paths.markerPath, {
		...marker,
		lastValidatedAt: new Date().toISOString(),
		lastValidatedVersion: version,
	} satisfies LegacyFixtureMarker)
}
