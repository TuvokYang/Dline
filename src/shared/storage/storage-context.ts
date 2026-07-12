import fsSync from "node:fs"
import path from "node:path"
import { getDlineDataDir, getDlineDocumentsPathSync } from "@core/storage/disk"
import { ClineFileStorage } from "./ClineFileStorage"
import { ClineMemento } from "./ClineStorage"

/**
 * The storage backend context object used by StateManager and other components.
 * Global, workspace and secret key-value storage goes through this component.
 *
 * This replaces the previous pattern of passing VSCode's ExtensionContext around
 * for storage access. All platforms (VSCode, CLI, JetBrains) use the same
 * file-backed implementation.
 */
export interface StorageContext {
	/** Global state — settings, task history references, UI state, etc. */
	readonly globalState: ClineMemento

	// TODO: Privatize this field after StorageContext becomes class with a reset method.
	/**
	 * The backing store for global state. Prefer `globalState` when possible.
	 *
	 * This split exists because CLI needs to intercept the ClineMemento interface to global state,
	 * but state resets need to write through to the backing store.
	 */
	readonly globalStateBackingStore: ClineFileStorage

	/** Settings — user preferences, mode, auto-approval, browser settings, etc. Stored in settings/settings.json */
	readonly settings: ClineFileStorage

	/** Backing store for settings. Prefer `settings` when possible. */
	readonly settingsBackingStore: ClineFileStorage

	/** Secrets — API keys and other sensitive values. File uses restricted permissions (0o600). */
	readonly secrets: ClineFileStorage<string>

	/** Workspace-scoped state — per-project toggles, rules, etc. */
	readonly workspaceState: ClineFileStorage

	/** The resolved path to the data directory (~/.cline/data) */
	readonly dataDir: string

	/** The resolved path to the workspace storage directory (contains workspaceState.json) */
	readonly workspaceStoragePath: string

	/** The task history JSONL path owned by this storage boundary. */
	readonly taskHistoryPath: string
}

export interface StorageContextOptions {
	/**
	 * Override the Cline home directory. Defaults to CLINE_DIR env var or ~/.cline.
	 */
	clineDir?: string

	/**
	 * The workspace/project directory path. Used to compute a hash-based
	 * workspace storage subdirectory. Defaults to process.cwd().
	 */
	workspacePath?: string

	/**
	 * Explicit workspace storage directory override.
	 * When set, this path is used directly instead of computing a hash.
	 * Used by JetBrains (via WORKSPACE_STORAGE_DIR env var).
	 *
	 * TODO: Unify JetBrains workspace path scheme with the hash-based approach
	 * once the JetBrains client side is cleaned up.
	 */
	workspaceStorageDir?: string
}

const SETTINGS_SUBFOLDER = "data"
const TASK_HISTORY_FILENAME = "taskHistory.jsonl"

/**
 * Create a short deterministic hash of a string for use in directory names.
 * Produces an up-to-8-character hex string.
 */
function hashString(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(16).substring(0, 8)
}

/**
 * Creates a StorageContext backed by JSON files on disk.
 *
 * All path computation is contained here — callers should not
 * construct paths to these storage files themselves.
 *
 * File layout:
 *   ~/.cline/data/globalState.json    — global state
 *   ~/.cline/data/secrets.json        — secrets (mode 0o600)
 *   ~/.cline/data/workspaces/<hash>/workspaceState.json — per-workspace state
 *
 * @param opts Configuration options for path resolution
 * @returns A StorageContext ready for use by StateManager
 */
export function createStorageContext(opts: StorageContextOptions = {}): StorageContext {
	// Use unified getDlineDataDir() which respects DLINE_DIR → CLINE_DIR → ~/.dline
	const dataDir = opts.clineDir ? path.join(opts.clineDir, SETTINGS_SUBFOLDER) : getDlineDataDir()

	// Resolve workspace storage directory
	let workspaceDir: string
	if (opts.workspaceStorageDir) {
		// Explicit override (JetBrains via env var, or test overrides)
		workspaceDir = opts.workspaceStorageDir
	} else {
		// Hash-based workspace isolation (CLI, VSCode)
		const workspacePath = opts.workspacePath || process.cwd()
		const workspaceHash = hashString(workspacePath)
		workspaceDir = path.join(dataDir, "workspaces", workspaceHash)
	}

	// Ensure directories exist
	fsSync.mkdirSync(dataDir, { recursive: true })
	fsSync.mkdirSync(workspaceDir, { recursive: true })

	const settingsDir = path.join(dataDir, "settings")
	fsSync.mkdirSync(settingsDir, { recursive: true })
	const settings = new ClineFileStorage(path.join(settingsDir, "settings.json"), "Settings")

	const globalState = new ClineFileStorage(path.join(dataDir, "globalState.json"), "GlobalState")
	const taskRoot = opts.clineDir ?? getDlineDocumentsPathSync()
	const taskHistoryPath = path.join(taskRoot, "tasks", TASK_HISTORY_FILENAME)

	return {
		globalState,
		globalStateBackingStore: globalState,
		settings,
		settingsBackingStore: settings,
		secrets: new ClineFileStorage<string>(path.join(dataDir, "secrets.json"), "Secrets", {
			fileMode: 0o600, // Owner read/write only — protects API keys
		}),
		workspaceState: new ClineFileStorage(path.join(workspaceDir, "workspaceState.json"), "WorkspaceState"),
		dataDir,
		workspaceStoragePath: workspaceDir,
		taskHistoryPath,
	}
}
