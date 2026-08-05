import { EnvironmentMetadataEntry, TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import type { FrozenPromptBuilderInfo, TaskContextCache } from "@core/storage/task-context-types"
import { execa } from "@packages/execa"
import { ClineMessage } from "@shared/ExtensionMessage"
import { envFlagEnabled } from "@shared/env"
import { HistoryItem } from "@shared/HistoryItem"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { RemoteConfig } from "@shared/remote-config/schema"
import { GlobalState, Settings } from "@shared/storage/state-keys"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { telemetryService } from "@/services/telemetry"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { normalizeLegacyConversation } from "@/shared/messages/legacy-identity-migration"
import { Logger } from "@/shared/services/Logger"
import { appendJsonl, readJsonl, writeJsonl } from "./jsonl-utils"

const ATOMIC_WRITE_RENAME_MAX_ATTEMPTS = 5
const ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100]
const RETRYABLE_RENAME_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES"])

/** Maximum age for task history lock file before it's considered stale (10 seconds). */
const _TASK_HISTORY_LOCK_TIMEOUT_MS = 10_000

function isRetryableRenameError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code
	return typeof code === "string" && RETRYABLE_RENAME_ERROR_CODES.has(code)
}
async function renameWithRetry(tmpPath: string, filePath: string): Promise<void> {
	for (let attempt = 1; attempt <= ATOMIC_WRITE_RENAME_MAX_ATTEMPTS; attempt++) {
		try {
			await fs.rename(tmpPath, filePath)
			return
		} catch (error) {
			if (!isRetryableRenameError(error) || attempt === ATOMIC_WRITE_RENAME_MAX_ATTEMPTS) throw error
			const delayMs = ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS[attempt - 1] ?? ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS.at(-1) ?? 0
			await new Promise((r) => setTimeout(r, delayMs))
		}
	}
}
/**
 * Atomically write data to a file using a temp file + rename.
 * On failure, cleans up the temp file.
 */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		await fs.writeFile(tmpPath, data, "utf8")
		await renameWithRetry(tmpPath, filePath)
	} catch (e) {
		// Clean up the temp file on any failure
		fs.unlink(tmpPath).catch(() => {})
		throw e
	}
}

/**
 * Clean up stale .tmp.*.json files left behind by atomicWriteFile.
 * These can accumulate if the process crashes between writeFile and rename.
 * Only cleans files older than STALE_TMP_FILE_AGE_MS to avoid racing with active writes.
 */
const STALE_TMP_FILE_AGE_MS = 60_000

async function cleanupStaleTmpFiles(dir: string): Promise<void> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		const now = Date.now()
		for (const entry of entries) {
			if (!entry.isFile()) continue
			const match = entry.name.match(/^(.+)\.tmp\.(\d{13})\.([a-z0-9]+)\.json$/)
			if (!match) continue
			const ts = Number.parseInt(match[2], 10)
			if (Number.isNaN(ts)) continue
			if (now - ts > STALE_TMP_FILE_AGE_MS) {
				const fp = path.join(dir, entry.name)
				await fs.unlink(fp).catch(() => {})
			}
		}
	} catch {
		// Directory may not exist yet — ignore
	}
}

export const GlobalFileNames = {
	apiConversationAll: "api_conversation_all.jsonl",
	taskSnapshot: "snapshot.json",
	taskActivities: "activities.json",
	taskContext: "context.json",
	apiConversationHistory: "api_conversation_history.jsonl",
	contextHistory: "context_history.jsonl",
	uiMessages: "ui_messages.jsonl",
	clineRecommendedModels: "cline_recommended_models.json",
	clineModels: "cline_models.json",
	openRouterModels: "openrouter_models.json",
	vercelAiGatewayModels: "vercel_ai_gateway_models.json",
	groqModels: "groq_models.json",
	basetenModels: "baseten_models.json",
	hicapModels: "hicap_models.json",
	mcpSettings: "mcp_settings.json",
	dlineDir: ".dline",
	dlineRulesDir: ".dline/rules",
	hooksDir: ".dline/hooks",
	mcpDir: ".dline/mcp",
	pluginDir: ".dline/plugin",
	agentsWorkflowsDir: ".agents/workflows",
	clineruleWorkflowsDir: ".clinerules/workflows",
	clineruleSkillsDir: ".clinerules/skills",
	clineSkillsDir: ".cline/skills",
	claudeSkillsDir: ".claude/skills",
	agentsSkillsDir: ".agents/skills",
	agentsSubagentsDir: ".agents/subagents",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	agentsRulesFile: "AGENTS.md",
	taskMetadata: "task_metadata.json",
	mcpMarketplaceCatalog: "mcp_marketplace_catalog.json",
	remoteConfig: (orgId: string) => `remote_config_${orgId}.json`,
}

let cachedDocumentsPath: string | undefined

export async function getDocumentsPath(): Promise<string> {
	if (cachedDocumentsPath) return cachedDocumentsPath

	if (process.platform === "win32") {
		try {
			const { stdout: docsPath } = await execa("powershell", [
				"-NoProfile",
				"-Command",
				"[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)",
			])
			if (docsPath.trim()) {
				cachedDocumentsPath = docsPath.trim()
				return cachedDocumentsPath
			}
		} catch {
			Logger.error("Failed to retrieve Windows Documents path.")
		}
	} else if (process.platform === "linux") {
		try {
			await execa("which", ["xdg-user-dir"])
			const { stdout } = await execa("xdg-user-dir", ["DOCUMENTS"])
			if (stdout.trim()) {
				cachedDocumentsPath = stdout.trim()
				return cachedDocumentsPath
			}
		} catch {
			Logger.error("Failed to retrieve XDG Documents path.")
		}
	}

	cachedDocumentsPath = path.join(os.homedir(), "Documents")
	return cachedDocumentsPath
}

export function getDlineHomePath(): string {
	if (process.env.DLINE_HOME_DIR) return process.env.DLINE_HOME_DIR
	return path.join(os.homedir(), ".dline")
}

/**
 * Get the Dline data directory path.
 * Used by StateManager for secrets/state storage and api_profiles.
 *
 * Priority: DLINE_DIR (secrets/test override) → ~/.dline
 * Note: DLINE_DIR is separate from DLINE_HOME_DIR — the former is for
 * secrets/sensitive data that may be redirected during testing, while the
 * latter is for the main .dline directory (providers, rules, etc.).
 */
export function getDlineDataDir(): string {
	const dlineDir = process.env.DLINE_DIR || path.join(os.homedir(), ".dline")
	return path.join(dlineDir, "data")
}
export function getDlineDocumentsPathSync(): string {
	if (process.env.DLINE_DOCS_DIR) return process.env.DLINE_DOCS_DIR
	if (cachedDocumentsPath) return path.join(cachedDocumentsPath, "dline")
	return path.join(os.homedir(), "Documents", "dline")
}

/**
 * Prime the Documents path cache at startup so synchronous consumers
 * (getDlineDocumentsPathSync) use the correct system Documents directory.
 * Call once during extension initialization, before any filesystem operations.
 */
export async function warmupDocumentsPathCache(): Promise<void> {
	await getDocumentsPath()
}
let cachedDlineDocumentsPath: string | undefined

export async function getDlineDocumentsPath(): Promise<string> {
	if (process.env.DLINE_DOCS_DIR) return process.env.DLINE_DOCS_DIR
	if (cachedDlineDocumentsPath) return cachedDlineDocumentsPath
	cachedDlineDocumentsPath = path.join(await getDocumentsPath(), "dline")
	return cachedDlineDocumentsPath
}

export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "tasks", taskId)
	await fs.mkdir(dir, { recursive: true })
	return dir
}
export async function ensureRulesDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "rules")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "dline", "rules")
	}
	return dir
}
export async function ensureWorkflowsDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "workflows")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "dline", "workflows")
	}
	return dir
}
export async function ensureMcpServersDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "mcp")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "dline", "mcp")
	}
	return dir
}
export async function ensureHooksDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "hooks")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "dline", "hooks")
	}
	return dir
}

function getDlineSkillsDirectoryPath(): string {
	return path.join(getDlineDocumentsPathSync(), "skills")
}

export function getDlineSubagentsDirectoryPath(): string {
	return path.join(getDlineDocumentsPathSync(), "subagents")
}

export async function getDlineCheckpointsDir(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "checkpoints")
	await fs.mkdir(dir, { recursive: true })
	return dir
}

export async function getDlineTasksDir(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "tasks")
	await fs.mkdir(dir, { recursive: true })
	return dir
}

export function getDlinePuppeteerDir(): string {
	const dir = path.join(getDlineHomePath(), "puppeteer")
	return dir
}

export function getDlineCacheDir(): string {
	const dir = path.join(getDlineHomePath(), "cache")
	return dir
}

function getAgentSkillsDirectoryPath(): string {
	return path.join(os.homedir(), ".agents", "skills")
}

export async function ensureAgentSkillsDirectoryExists(opts: { isGlobal: boolean; workspacePath?: string }): Promise<string> {
	const dir = opts.isGlobal
		? getAgentSkillsDirectoryPath()
		: path.join(opts.workspacePath ?? "", GlobalFileNames.agentsSkillsDir)
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return dir
	}
	return dir
}

/**
 * Ensure subagents directory exists.
 * Global: ~/Documents/dline/subagents
 * Project: .agents/subagents/
 */
export async function ensureAgentSubagentsDirectoryExists(opts: { isGlobal: boolean; workspacePath?: string }): Promise<string> {
	const dir = opts.isGlobal
		? getDlineSubagentsDirectoryPath()
		: path.join(opts.workspacePath ?? "", GlobalFileNames.agentsSubagentsDir)
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return dir
	}
	return dir
}

/**
 * Ensure dline rules directory exists.
 * Global: ~/Documents/dline/rules
 * Deprecated: use ensureRulesDirectoryExists for global rules.
 */
export async function ensureDlineRulesDirectoryExists(opts: { isGlobal: boolean; workspacePath?: string }): Promise<string> {
	const dir = opts.isGlobal
		? path.join(getDlineDocumentsPathSync(), "rules")
		: path.join(opts.workspacePath ?? "", GlobalFileNames.dlineRulesDir)
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return dir
	}
	return dir
}

export type SkillsScanDirectory = { path: string; source: "project" | "global" }
export function getSkillsDirectoriesForScan(cwd: string): SkillsScanDirectory[] {
	return [
		{ path: path.join(cwd, GlobalFileNames.clineruleSkillsDir), source: "project" },
		{ path: path.join(cwd, GlobalFileNames.clineSkillsDir), source: "project" },
		{ path: path.join(cwd, GlobalFileNames.claudeSkillsDir), source: "project" },
		{ path: path.join(cwd, GlobalFileNames.agentsSkillsDir), source: "project" },
		{ path: getDlineSkillsDirectoryPath(), source: "global" },
		{ path: getAgentSkillsDirectoryPath(), source: "global" },
	]
}

/**
 * Scan directories for subagent YAML configs.
 * Project: .agents/subagents/
 * Global: ~/Documents/dline/subagents/
 */
export function getSubagentsScanDirectories(cwd: string): SkillsScanDirectory[] {
	return [
		{ path: path.join(cwd, GlobalFileNames.agentsSubagentsDir), source: "project" },
		{ path: getDlineSubagentsDirectoryPath(), source: "global" },
	]
}

/**
 * Scan directories for workflow files.
 * Project: .agents/workflows/ (new) + .clinerules/workflows/ (legacy compat)
 * Global: ~/Documents/dline/workflows/
 */
export function getWorkflowsScanDirectories(cwd: string): SkillsScanDirectory[] {
	return [
		{ path: path.join(cwd, GlobalFileNames.agentsWorkflowsDir), source: "project" },
		{ path: path.join(cwd, GlobalFileNames.clineruleWorkflowsDir), source: "project" },
		{ path: path.join(getDlineDocumentsPathSync(), "workflows"), source: "global" },
	]
}

export async function ensureSettingsDirectoryExists(): Promise<string> {
	return getDlineStorageDir("settings")
}
export async function getMcpSettingsFilePath(settingsDirectoryPath: string): Promise<string> {
	const p = path.join(settingsDirectoryPath, GlobalFileNames.mcpSettings)
	if (!(await fileExistsAtPath(p))) await fs.writeFile(p, JSON.stringify({ mcpServers: {} }, null, 2))
	return p
}
export async function getSavedApiConversationHistory(taskId: string): Promise<ClineStorageMessage[]> {
	const dir = await ensureTaskDirectoryExists(taskId)
	const p = path.join(dir, GlobalFileNames.apiConversationHistory)

	// If .jsonl exists, use it exclusively — never fall back to legacy .json
	if (await fileExistsAtPath(p)) {
		const stored = await readJsonl<unknown>(p)
		const normalized = normalizeLegacyConversation(stored)
		if (JSON.stringify(stored) !== JSON.stringify(normalized)) await writeJsonl(p, normalized)
		return normalized
	}

	// Migrate: read legacy .json, write to .jsonl, preserve old file as backup
	const legacyP = path.join(dir, "api_conversation_history.json")
	if (await fileExistsAtPath(legacyP)) {
		const legacyMsgs = await readJsonl<unknown>(legacyP)
		const normalized = normalizeLegacyConversation(legacyMsgs)
		if (legacyMsgs.length > 0) {
			await writeJsonl(p, normalized)
		}
		return normalized
	}
	return []
}
export async function saveApiConversationHistory(taskId: string, h: ClineStorageMessage[]) {
	if (h.length === 0) return
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	await writeJsonl(p, h)
}
/**
 * Deduplicate ClineMessage array by timestamp (ts), keeping the last
 * occurrence for each ts. Used because incremental appends (addToClineMessages
 * + flushMessageUpdate) may produce duplicate rows for the same message
 * (initial partial write + final complete write).
 */
export function dedupeClineMessagesByTs(messages: ClineMessage[]): ClineMessage[] {
	if (messages.length <= 1) return messages
	const seen = new Map<number, ClineMessage>()
	// Walk in order; later entries overwrite earlier ones for the same ts
	for (const msg of messages) {
		seen.set(msg.ts, msg)
	}
	// Preserve insertion order by collecting in original order,
	// but only keeping the last occurrence for each ts
	const deduped: ClineMessage[] = []
	const included = new Set<number>()
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (!included.has(msg.ts)) {
			included.add(msg.ts)
			deduped.unshift(msg)
		}
	}
	return deduped
}

export async function getSavedClineMessages(taskId: string): Promise<ClineMessage[]> {
	const dir = await ensureTaskDirectoryExists(taskId)
	const p = path.join(dir, GlobalFileNames.uiMessages)

	// If .jsonl exists, use it exclusively — never fall back to legacy .json
	if (await fileExistsAtPath(p)) {
		const raw = await readJsonl<ClineMessage>(p)
		return dedupeClineMessagesByTs(raw)
	}

	// Migrate: read legacy .json, write to .jsonl, preserve old file as backup
	const legacyP = path.join(dir, "ui_messages.json")
	if (await fileExistsAtPath(legacyP)) {
		const legacyMsgs = await readJsonl<ClineMessage>(legacyP)
		if (legacyMsgs.length > 0) {
			await writeJsonl(p, legacyMsgs)
		}
		return dedupeClineMessagesByTs(legacyMsgs)
	}
	// Legacy: claude_messages.json migration (no .jsonl exists yet)
	const old = path.join(dir, "claude_messages.json")
	if (await fileExistsAtPath(old)) {
		const d = await readJsonl<ClineMessage>(old)
		if (d.length > 0) {
			await writeJsonl(p, d)
		}
		return dedupeClineMessagesByTs(d)
	}
	return []
}
export async function saveClineMessages(taskId: string, m: ClineMessage[]) {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.uiMessages)
	await writeJsonl(p, m)
}

/**
 * Atomically append a single ClineMessage to the JSONL file.
 * Uses fs.appendFile which guarantees atomicity for single-line writes.
 *
 * @param taskId Task identifier
 * @param message Single message to append
 */
export async function appendClineMessage(taskId: string, message: ClineMessage): Promise<void> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.uiMessages)
	await appendJsonl(p, message)
}

/**
 * Atomically append a single API conversation message to the JSONL file.
 *
 * @param taskId Task identifier
 * @param message Single message to append
 */
export async function appendApiConversationMessage(taskId: string, message: ClineStorageMessage): Promise<void> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	await appendJsonl(p, message)
}

/**
 * Append one canonical API round event to the debug JSONL file.
 * Controlled by DLINE_LOG_API_CONTEXT=1 or IS_DEV=true environment variables.
 * Request, response chunk, and response-end events are written separately so
 * the file reflects the actual ordering of every main-task and subagent round.
 *
 * @param taskId Task identifier
 * @param entry Full request context object to append
 */
export async function appendApiConversationEvent(taskId: string, entry: object): Promise<void> {
	if (!envFlagEnabled(process.env.IS_DEV) && !envFlagEnabled(process.env.DLINE_LOG_API_CONTEXT)) return
	try {
		const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationAll)
		await appendJsonl(p, entry)
	} catch (error) {
		Logger.error("[appendApiConversationEvent] Failed to write api_conversation_all.jsonl:", error)
	}
}

export async function collectEnvironmentMetadata(): Promise<Omit<EnvironmentMetadataEntry, "ts">> {
	try {
		const hv = await HostProvider.env.getHostVersion({})
		return {
			os_name: os.platform(),
			os_version: os.release(),
			os_arch: os.arch(),
			host_name: hv.platform || "Unknown",
			host_version: hv.version || "Unknown",
			cline_version: ExtensionRegistryInfo.version,
		}
	} catch {
		return {
			os_name: os.platform(),
			os_version: os.release(),
			os_arch: os.arch(),
			host_name: "Unknown",
			host_version: "Unknown",
			cline_version: "Unknown",
		}
	}
}
export async function getTaskMetadata(taskId: string): Promise<TaskMetadata> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskMetadata)
	try {
		if (!(await fileExistsAtPath(p))) {
			return { files_in_context: [], model_usage: [], environment_history: [] }
		}
		const raw = await fs.readFile(p, "utf8")
		return JSON.parse(raw) as TaskMetadata
	} catch {
		return { files_in_context: [], model_usage: [], environment_history: [] }
	}
}
export async function saveTaskMetadata(taskId: string, m: TaskMetadata) {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskMetadata)
	await fs.writeFile(p, JSON.stringify(m, null, 2), "utf8")
}

/**
 * Create an empty task context cache for a task.
 *
 * @param taskId Task identifier.
 * @returns Empty task context cache with timestamps.
 */
function createEmptyTaskContext(taskId: string): TaskContextCache {
	const now = Date.now()
	return {
		schemaVersion: 1,
		taskId,
		createdAt: now,
		updatedAt: now,
	}
}

/**
 * Validate task context cache shape before returning parsed JSON.
 *
 * @param value Parsed JSON value.
 * @param taskId Expected task identifier.
 * @returns True when value is a supported task context cache.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0
}

function isFrozenTool(value: unknown): boolean {
	if (!isJsonObject(value)) return false
	if (value.type === "function") {
		return (
			isJsonObject(value.function) &&
			isNonEmptyString(value.function.name) &&
			typeof value.function.description === "string" &&
			isJsonObject(value.function.parameters) &&
			typeof value.function.strict === "boolean"
		)
	}
	if ("type" in value || !isNonEmptyString(value.name) || typeof value.description !== "string") return false
	if ("input_schema" in value) return isJsonObject(value.input_schema)
	if ("parameters" in value) return isJsonObject(value.parameters)
	return false
}

function isPromptBuilderInfo(value: unknown): value is FrozenPromptBuilderInfo {
	return (
		isJsonObject(value) &&
		(value.contractVersion === undefined ||
			(typeof value.contractVersion === "number" && Number.isInteger(value.contractVersion))) &&
		isNonEmptyString(value.providerId) &&
		isNonEmptyString(value.modelId) &&
		(value.profile === "standard" || value.profile === "lite") &&
		typeof value.nativeTools === "boolean" &&
		(value.apiFormat === undefined || isKnownApiFormat(value.apiFormat)) &&
		(value.serverTools === undefined ||
			(Array.isArray(value.serverTools) && value.serverTools.every((tool) => isKnownServerTool(tool)))) &&
		(value.webToolsEnabled === undefined || typeof value.webToolsEnabled === "boolean") &&
		(value.webSearchRoute === undefined ||
			value.webSearchRoute === "disabled" ||
			value.webSearchRoute === "local" ||
			value.webSearchRoute === "hosted" ||
			value.webSearchRoute === "unavailable")
	)
}

function isKnownApiFormat(value: unknown): value is ApiFormat {
	return (
		value === ApiFormat.ANTHROPIC_CHAT ||
		value === ApiFormat.GEMINI_CHAT ||
		value === ApiFormat.OPENAI_CHAT ||
		value === ApiFormat.R1_CHAT ||
		value === ApiFormat.OPENAI_RESPONSES ||
		value === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
	)
}

function isKnownServerTool(value: unknown): value is ServerTool {
	return value === ServerTool.WEB_SEARCH
}

/** Normalize the legacy prompt profile name before validating a persisted cache. */
function migrateLegacyPromptProfile(value: unknown): void {
	if (!isJsonObject(value)) return
	const systemPrompt = value.systemPrompt
	if (!isJsonObject(systemPrompt)) return
	const frozen = systemPrompt.frozen
	if (!isJsonObject(frozen)) return
	const promptBuilder = frozen.promptBuilder
	if (isJsonObject(promptBuilder) && promptBuilder.profile === "native") {
		promptBuilder.profile = "standard"
	}
}

function isFrozenSystemPromptCache(value: unknown): boolean {
	if (!isJsonObject(value)) return false
	const toolsValid = value.tools === null || (Array.isArray(value.tools) && value.tools.every(isFrozenTool))
	if (!toolsValid || !isPromptBuilderInfo(value.promptBuilder)) return false
	const hasNativeTools = Array.isArray(value.tools) && value.tools.length > 0
	return (
		isNonEmptyString(value.text) &&
		"tools" in value &&
		value.promptBuilder.nativeTools === hasNativeTools &&
		isNonEmptyString(value.capabilitiesHash) &&
		typeof value.createdAt === "number" &&
		Number.isFinite(value.createdAt) &&
		typeof value.refreshedAt === "number" &&
		Number.isFinite(value.refreshedAt) &&
		(value.refreshReason === "task_start" ||
			value.refreshReason === "manual" ||
			value.refreshReason === "post_compaction" ||
			value.refreshReason === "capability_change" ||
			value.refreshReason === "mode_switch")
	)
}

function isTaskContextCache(value: unknown, taskId: string): value is TaskContextCache {
	if (!isJsonObject(value)) return false
	if (
		value.schemaVersion !== 1 ||
		value.taskId !== taskId ||
		typeof value.createdAt !== "number" ||
		!Number.isFinite(value.createdAt) ||
		typeof value.updatedAt !== "number" ||
		!Number.isFinite(value.updatedAt)
	) {
		return false
	}
	if (!("systemPrompt" in value)) return true
	if (!isJsonObject(value.systemPrompt)) return false
	if (!("frozen" in value.systemPrompt)) return true
	return isFrozenSystemPromptCache(value.systemPrompt.frozen)
}

/**
 * Read task-level context cache from context.json.
 *
 * @param taskId Task identifier.
 * @returns Stored task context cache, or an empty cache when missing or invalid.
 */
export async function getTaskContext(taskId: string): Promise<TaskContextCache> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskContext)
	try {
		if (!(await fileExistsAtPath(p))) {
			return createEmptyTaskContext(taskId)
		}
		const parsed = JSON.parse(await fs.readFile(p, "utf8")) as unknown
		migrateLegacyPromptProfile(parsed)
		if (!isTaskContextCache(parsed, taskId)) {
			Logger.warn(`[getTaskContext] Invalid task context cache shape for task ${taskId}`)
			return createEmptyTaskContext(taskId)
		}
		return parsed
	} catch (error) {
		Logger.warn(`[getTaskContext] Failed to read task context cache for task ${taskId}:`, error)
		return createEmptyTaskContext(taskId)
	}
}

/**
 * Persist task-level context cache to context.json.
 *
 * @param taskId Task identifier.
 * @param context Task context cache to persist.
 */
export async function saveTaskContext(taskId: string, context: TaskContextCache): Promise<void> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskContext)
	await atomicWriteFile(p, JSON.stringify(context, null, 2))
}

export async function ensureStateDirectoryExists(): Promise<string> {
	return getDlineStorageDir("state")
}
export async function ensureCacheDirectoryExists(): Promise<string> {
	const dir = getDlineCacheDir()
	await fs.mkdir(dir, { recursive: true })
	return dir
}

export async function readMcpMarketplaceCatalogFromCache(): Promise<McpMarketplaceCatalog | undefined> {
	try {
		const p = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.mcpMarketplaceCatalog)
		if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	} catch {}
	return undefined
}
export async function writeMcpMarketplaceCatalogToCache(c: McpMarketplaceCatalog): Promise<void> {
	await fs.writeFile(path.join(await ensureCacheDirectoryExists(), GlobalFileNames.mcpMarketplaceCatalog), JSON.stringify(c))
}

async function getDlineStorageDir(...subdirs: string[]): Promise<string> {
	const d = await getDlineDocumentsPath()
	const p = path.resolve(d, ...subdirs)
	await fs.mkdir(p, { recursive: true })
	return p
}

// ─────────────────────────────────────────────────────────
// TASK HISTORY — JSONL storage with file locking
// ─────────────────────────────────────────────────────────

const TASK_HISTORY_FILENAME = "taskHistory.jsonl"
const LEGACY_TASK_HISTORY_FILENAME = "taskHistory.json"

function _getTaskHistoryLockPath(): string {
	return path.join(getDlineDocumentsPathSync(), "tasks", `${TASK_HISTORY_FILENAME}.lck`)
}

async function getTaskHistoryFilePath(): Promise<string> {
	const d = await getDlineDocumentsPath()
	return path.join(d, "tasks", TASK_HISTORY_FILENAME)
}

async function getLegacyTaskHistoryFilePath(): Promise<string> {
	const d = await getDlineDocumentsPath()
	return path.join(d, "tasks", LEGACY_TASK_HISTORY_FILENAME)
}

/**
 * Append a single HistoryItem as a JSONL line to taskHistory.jsonl.
 * @deprecated Use TaskHistory.upsert() instead.
 * Lines are appended in time order; later lines naturally have higher ts.
 */
export async function appendTaskHistoryItem(item: HistoryItem): Promise<void> {
	const fp = await getTaskHistoryFilePath()
	await appendJsonl(fp, item)
}

/**
 * Read task history from JSONL file.
 * Because lines are appended in time order, later occurrences of the
 * same id naturally have a higher ts. We deduplicate by id, keeping
 * the last occurrence. Entries marked with _deleted are excluded.
 */
/** @deprecated Use TaskHistory.getDeduplicated() instead. */
export async function readTaskHistoryJsonl(): Promise<HistoryItem[]> {
	const fp = await getTaskHistoryFilePath()
	if (!(await fileExistsAtPath(fp))) {
		return []
	}
	const rows = await readJsonl<HistoryItem & { _deleted?: boolean }>(fp)
	// Deduplicate by id: later occurrence overwrites earlier (higher ts)
	const byId = new Map<string, HistoryItem & { _deleted?: boolean }>()
	for (const row of rows) {
		byId.set(row.id, row)
	}
	// Exclude deleted entries, sort by ts descending
	return [...byId.values()].filter((item) => !(item as any)._deleted).sort((a, b) => b.ts - a.ts)
}

/**
 * Full overwrite of task history JSONL. Used only for compact/reconstruct.
 */
/** @deprecated Use TaskHistory.upsert() or clearAll() instead. */
export async function writeTaskHistoryToState(items: HistoryItem[], targetPath?: string): Promise<void> {
	const fp = targetPath ?? (await getTaskHistoryFilePath())
	const dir = path.dirname(fp)
	await fs.mkdir(dir, { recursive: true })
	await writeJsonl(fp, items)
	// Clean up stale tmp files that may have accumulated from atomic writes
	await cleanupStaleTmpFiles(dir)
}

export async function getTaskHistoryStateFilePath(): Promise<string> {
	return getTaskHistoryFilePath()
}

export async function taskHistoryStateFileExists(): Promise<boolean> {
	return fileExistsAtPath(await getTaskHistoryFilePath())
}

export async function readTaskHistoryRecent(limit = 5): Promise<HistoryItem[]> {
	try {
		const items = await readTaskHistoryFromState()
		return items
			.filter((i) => i.ts)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, limit)
	} catch {
		return []
	}
}

/**
 * Read task history from persistent storage.
 *
 * Priority:
 *  1. taskHistory.jsonl exists → read JSONL, deduplicate
 *  2. taskHistory.json  exists → migrate to JSONL
 *  3. Neither exists         → return an empty history
 *
 * Reconstruction is an explicit user command and must never be triggered by a read.
 */
/** @deprecated Use TaskHistory.getDeduplicated() instead. */
export async function readTaskHistoryFromState(): Promise<HistoryItem[]> {
	try {
		const jsonlPath = await getTaskHistoryFilePath()

		// Priority 1: JSONL exists
		if (await fileExistsAtPath(jsonlPath)) {
			return readTaskHistoryJsonl()
		}

		// Priority 2: Migrate legacy JSON
		const legacyPath = await getLegacyTaskHistoryFilePath()
		if (await fileExistsAtPath(legacyPath)) {
			const raw = await fs.readFile(legacyPath, "utf8")
			if (raw.trim()) {
				try {
					const items = JSON.parse(raw) as HistoryItem[]
					if (Array.isArray(items) && items.length > 0) {
						// Migrate: write to JSONL, keep old .json as .bak
						await writeTaskHistoryToState(items)
						const bakPath = `${legacyPath}.bak`
						await fs.rename(legacyPath, bakPath).catch(() => {})
						return items
					}
				} catch {
					telemetryService.captureExtensionStorageError("Corrupted taskHistory.json", "parseError")
					return []
				}
			}
		}

		// Priority 3: Missing history is a valid empty state.
		return []
	} catch (e) {
		telemetryService.captureExtensionStorageError(e, "readTaskHistoryFromState")
		throw e
	}
}

/**
 * Get the task header/description text for a given task.
 * Currently reads the first "say === task" message from ui_messages.jsonl.
 *
 * TODO: Future enhancement — replace with AI-generated summary stored
 * in a dedicated storage entry (e.g., task_summary.jsonl per task),
 * enabling richer task history list display with custom titles.
 *
 * @param taskId Task identifier
 * @returns Task description text, or "" if not found
 */
export async function getTaskHeaderText(taskId: string): Promise<string> {
	const messages = await getSavedClineMessages(taskId)
	const taskMsg = messages.find((m) => m.say === "task")
	return taskMsg?.text ?? ""
}

export async function readTaskSettingsFromStorage(taskId: string): Promise<Partial<GlobalState>> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), "settings.json")
	if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	return {}
}
export async function writeTaskSettingsToStorage(taskId: string, s: Partial<Settings>) {
	const p = path.join(await ensureTaskDirectoryExists(taskId), "settings.json")
	let e: Record<string, unknown> = {}
	if (await fileExistsAtPath(p)) e = JSON.parse(await fs.readFile(p, "utf8"))
	const next = { ...e }
	for (const [key, value] of Object.entries(s)) {
		if (value === undefined) {
			delete next[key]
		} else {
			next[key] = value
		}
	}
	await fs.writeFile(p, JSON.stringify(next, null, 2))
}

export async function readRemoteConfigFromCache(orgId: string): Promise<RemoteConfig | undefined> {
	try {
		const p = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(orgId))
		if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	} catch {}
	return undefined
}
export async function writeRemoteConfigToCache(orgId: string, c: RemoteConfig): Promise<void> {
	await fs.writeFile(path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(orgId)), JSON.stringify(c))
}
export async function deleteRemoteConfigFromCache(orgId: string): Promise<void> {
	const p = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(orgId))
	if (await fileExistsAtPath(p)) await fs.unlink(p)
}

export async function getGlobalHooksDir(): Promise<string | undefined> {
	const d = await ensureHooksDirectoryExists()
	return (await isDirectory(d)) ? d : undefined
}
let runtimeHooksDir: string | undefined
export function setRuntimeHooksDir(dir: string | undefined): void {
	runtimeHooksDir = dir
}

export async function getAllHooksDirs(): Promise<string[]> {
	const dirs: string[] = []
	if (runtimeHooksDir && (await isDirectory(runtimeHooksDir))) dirs.push(runtimeHooksDir)
	const g = await getGlobalHooksDir()
	if (g) dirs.push(g)
	dirs.push(...(await getWorkspaceHooksDirs()))
	return dirs
}
export async function getWorkspaceHooksDirs(): Promise<string[]> {
	const { StateManager } = await import("./StateManager")
	const roots =
		StateManager.get()
			.getGlobalStateKey("workspaceRoots")
			?.map((r) => r.path) || []
	return (
		await Promise.all(
			roots.map(async (r) => {
				const c = path.join(r, GlobalFileNames.hooksDir)
				return (await isDirectory(c)) ? c : undefined
			}),
		)
	).filter((p): p is string => Boolean(p))
}

export async function writeConversationHistoryJson(taskId: string, h: ClineStorageMessage[], ts?: number): Promise<string> {
	const d = await ensureTaskDirectoryExists(taskId)
	const p = path.join(d, `conversation_history_${ts ?? Date.now()}.jsonl`)
	await writeJsonl(p, h)
	return p
}
export async function cleanupConversationHistoryFile(fp: string): Promise<void> {
	try {
		if (await fileExistsAtPath(fp)) await fs.unlink(fp)
	} catch {}
}

export async function writeConversationHistoryText(taskId: string, h: ClineStorageMessage[], ts?: number): Promise<string> {
	const d = await ensureTaskDirectoryExists(taskId)
	const p = path.join(d, `conversation_history_${ts ?? Date.now()}.txt`)
	let c = "=== CONVERSATION HISTORY ===\n\n"
	for (let i = 0; i < h.length; i++) {
		const m = h[i]
		c += `--- Message ${i + 1} (${m.role.toUpperCase()}) ---\n`
		if (typeof m.content === "string") {
			c += m.content
		} else if (Array.isArray(m.content)) {
			for (const b of m.content) {
				if (b.type === "text") c += b.text
				else if (b.type === "image") c += `[IMAGE]`
				else if (b.type === "tool_use") c += `[TOOL USE: ${b.name}]\n${JSON.stringify(b.input, null, 2)}`
				else if (b.type === "tool_result") {
					c += `[TOOL RESULT]\n`
					if (typeof b.content === "string") c += b.content
					else if (Array.isArray(b.content)) {
						for (const rb of b.content) {
							if (rb.type === "text") c += rb.text
						}
					}
				}
				c += "\n\n"
			}
		}
		c += "\n"
	}
	c += "=== END OF CONTEXT ===\n"
	await atomicWriteFile(p, c)
	return p
}
