import { Anthropic } from "@anthropic-ai/sdk"
import { EnvironmentMetadataEntry, TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { execa } from "@packages/execa"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
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
import { Logger } from "@/shared/services/Logger"
import { syncWorker } from "@/shared/services/worker/sync"
import { reconstructTaskHistory } from "../commands/reconstructTaskHistory"
import { StateManager } from "./StateManager"

const ATOMIC_WRITE_RENAME_MAX_ATTEMPTS = 5
const ATOMIC_WRITE_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100]
const RETRYABLE_RENAME_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES"])

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
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		await fs.writeFile(tmpPath, data, "utf8")
		await renameWithRetry(tmpPath, filePath)
	} catch (e) {
		fs.unlink(tmpPath).catch(() => {})
		throw e
	}
}

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	clineRecommendedModels: "cline_recommended_models.json",
	clineModels: "cline_models.json",
	openRouterModels: "openrouter_models.json",
	vercelAiGatewayModels: "vercel_ai_gateway_models.json",
	groqModels: "groq_models.json",
	basetenModels: "baseten_models.json",
	hicapModels: "hicap_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	workflows: ".clinerules/workflows",
	hooksDir: ".clinerules/hooks",
	clineruleSkillsDir: ".clinerules/skills",
	clineSkillsDir: ".cline/skills",
	claudeSkillsDir: ".claude/skills",
	agentsSkillsDir: ".agents/skills",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	agentsRulesFile: "AGENTS.md",
	taskMetadata: "task_metadata.json",
	mcpMarketplaceCatalog: "mcp_marketplace_catalog.json",
	remoteConfig: (orgId: string) => `remote_config_${orgId}.json`,
}

export async function getDocumentsPath(): Promise<string> {
	if (process.platform === "win32") {
		try {
			const { stdout: docsPath } = await execa("powershell", [
				"-NoProfile",
				"-Command",
				"[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)",
			])
			if (docsPath.trim()) return docsPath.trim()
		} catch {
			Logger.error("Failed to retrieve Windows Documents path.")
		}
	} else if (process.platform === "linux") {
		try {
			await execa("which", ["xdg-user-dir"])
			const { stdout } = await execa("xdg-user-dir", ["DOCUMENTS"])
			if (stdout.trim()) return stdout.trim()
		} catch {
			Logger.error("Failed to retrieve XDG Documents path.")
		}
	}
	return path.join(os.homedir(), "Documents")
}

export function getDlineHomePath(): string {
	if (process.env.DLINE_HOME_DIR) return process.env.DLINE_HOME_DIR
	return path.join(os.homedir(), ".dline")
}
export function getDlineDocumentsPathSync(): string {
	if (process.env.DLINE_DOCS_DIR) return process.env.DLINE_DOCS_DIR
	return path.join(os.homedir(), "Documents", "Dline")
}
export async function getDlineDocumentsPath(): Promise<string> {
	if (process.env.DLINE_DOCS_DIR) return process.env.DLINE_DOCS_DIR
	return path.join(await getDocumentsPath(), "Dline")
}

export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "tasks", taskId)
	await fs.mkdir(dir, { recursive: true })
	return dir
}
export async function ensureRulesDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "Rules")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "Dline", "Rules")
	}
	return dir
}
export async function ensureWorkflowsDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "Workflows")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "Dline", "Workflows")
	}
	return dir
}
export async function ensureMcpServersDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "MCP")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "Dline", "MCP")
	}
	return dir
}
export async function ensureHooksDirectoryExists(): Promise<string> {
	const d = await getDlineDocumentsPath()
	const dir = path.join(d, "Hooks")
	try {
		await fs.mkdir(dir, { recursive: true })
	} catch {
		return path.join(os.homedir(), "Documents", "Dline", "Hooks")
	}
	return dir
}

function getDlineSkillsDirectoryPath(): string {
	return path.join(getDlineDocumentsPathSync(), "Skills")
}

export function getDlineAgentsDirectoryPath(): string {
	return path.join(getDlineDocumentsPathSync(), "Agents")
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

export async function ensureSettingsDirectoryExists(): Promise<string> {
	return getDlineStorageDir("settings")
}
export async function getMcpSettingsFilePath(settingsDirectoryPath: string): Promise<string> {
	const p = path.join(settingsDirectoryPath, GlobalFileNames.mcpSettings)
	if (!(await fileExistsAtPath(p))) await fs.writeFile(p, JSON.stringify({ mcpServers: {} }, null, 2))
	return p
}
export async function getSavedApiConversationHistory(taskId: string): Promise<Anthropic.MessageParam[]> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	return []
}
export async function saveApiConversationHistory(taskId: string, h: Anthropic.MessageParam[]) {
	if (h.length > 0) {
		syncWorker().enqueue(taskId, GlobalFileNames.apiConversationHistory, JSON.stringify(h))
		await atomicWriteFile(
			path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory),
			JSON.stringify(h),
		)
	}
}
export async function getSavedClineMessages(taskId: string): Promise<ClineMessage[]> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	const old = path.join(await ensureTaskDirectoryExists(taskId), "claude_messages.json")
	if (await fileExistsAtPath(old)) {
		const d = JSON.parse(await fs.readFile(old, "utf8"))
		await fs.unlink(old)
		return d
	}
	return []
}
export async function saveClineMessages(taskId: string, m: ClineMessage[]) {
	await atomicWriteFile(path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.uiMessages), JSON.stringify(m))
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
		if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	} catch {}
	return { files_in_context: [], model_usage: [], environment_history: [] }
}
export async function saveTaskMetadata(taskId: string, m: TaskMetadata) {
	await fs.writeFile(
		path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskMetadata),
		JSON.stringify(m, null, 2),
	)
}

export async function ensureStateDirectoryExists(): Promise<string> {
	return getDlineStorageDir("state")
}
export async function ensureCacheDirectoryExists(): Promise<string> {
	return getDlineStorageDir("cache")
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

export async function getTaskHistoryStateFilePath(): Promise<string> {
	return path.join(await getDlineDocumentsPath(), "tasks", "taskHistory.json")
}
export async function taskHistoryStateFileExists(): Promise<boolean> {
	return fileExistsAtPath(await getTaskHistoryStateFilePath())
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
export async function readTaskHistoryFromState(): Promise<HistoryItem[]> {
	try {
		const p = await getTaskHistoryStateFilePath()
		if (!(await fileExistsAtPath(p))) return []
		const c = await fs.readFile(p, "utf8")
		try {
			return JSON.parse(c)
		} catch (e) {
			telemetryService.captureExtensionStorageError(e, "parseError_attemptingRecovery")
			const r = await reconstructTaskHistory(false)
			if (r && r.reconstructedTasks > 0) return JSON.parse(await fs.readFile(p, "utf8"))
			return []
		}
	} catch (e) {
		telemetryService.captureExtensionStorageError(e, "readTaskHistoryFromState")
		throw e
	}
}
export async function writeTaskHistoryToState(items: HistoryItem[]): Promise<void> {
	await atomicWriteFile(await getTaskHistoryStateFilePath(), JSON.stringify(items))
}

export async function readTaskSettingsFromStorage(taskId: string): Promise<Partial<GlobalState>> {
	const p = path.join(await ensureTaskDirectoryExists(taskId), "settings.json")
	if (await fileExistsAtPath(p)) return JSON.parse(await fs.readFile(p, "utf8"))
	return {}
}
export async function writeTaskSettingsToStorage(taskId: string, s: Partial<Settings>) {
	const p = path.join(await ensureTaskDirectoryExists(taskId), "settings.json")
	let e = {}
	if (await fileExistsAtPath(p)) e = JSON.parse(await fs.readFile(p, "utf8"))
	await fs.writeFile(p, JSON.stringify({ ...e, ...s }, null, 2))
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

export async function writeConversationHistoryJson(taskId: string, h: Anthropic.MessageParam[], ts?: number): Promise<string> {
	const d = await ensureTaskDirectoryExists(taskId)
	const p = path.join(d, `conversation_history_${ts ?? Date.now()}.json`)
	await atomicWriteFile(p, JSON.stringify(h, null, 2))
	return p
}
export async function cleanupConversationHistoryFile(fp: string): Promise<void> {
	try {
		if (await fileExistsAtPath(fp)) await fs.unlink(fp)
	} catch {}
}

export async function writeConversationHistoryText(taskId: string, h: Anthropic.MessageParam[], ts?: number): Promise<string> {
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
