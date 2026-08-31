import { normalizeWorkspaceRelativeInputPath } from "@core/workspace/utils/normalizeWorkspaceRelativeInputPath"
import { Logger } from "@shared/services/Logger"
import { fileExistsAtPath } from "@utils/fs"
import chokidar, { FSWatcher } from "chokidar"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import path from "path"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Which exclusion contract a caller is asking about.
 *
 * - `git`: only `.gitignore`. Used by checkpoints so the shadow repository keeps
 *   the same visibility as the user's real repository.
 * - `agent`: `.gitignore` plus `.agentignore`. Used by file reads, tool calls and
 *   prompt-input watching so the agent's view is the repository view narrowed (or
 *   re-widened via negation) by agent-specific rules.
 */
/**
 * The exclusion question being asked.
 *
 * - `git`: what the repository does not track. Owns checkpoints.
 * - `agent`: what discovery should not traverse or list. Repository rules apply
 *   here because build output and local caches are noise for the agent too.
 * - `read`: what the agent must not open. Only agent-authored rules apply: not
 *   tracking a path in git says nothing about whether reading it is allowed.
 */
export type IgnoreScope = "git" | "agent" | "read"

/** Workspace file holding agent-scoped rules, in `.gitignore` syntax. */
export const AGENT_IGNORE_FILE = ".agentignore"

/**
 * Accepted agent rule filenames, in precedence order.
 *
 * Only the first file that exists contributes rules, so a workspace using an
 * older name keeps working while a migrated one does not silently re-apply the
 * file it replaced.
 */
const AGENT_IGNORE_FILENAMES = [AGENT_IGNORE_FILE, ".dlineignore", ".clineignore"] as const

const GIT_IGNORE_FILE = ".gitignore"

/**
 * Directories never worth traversing, regardless of any ignore file.
 *
 * This is a floor, not a policy: it exists so a workspace without ignore files
 * still avoids the traversals that reliably dominate discovery cost. Everything
 * else must come from `.gitignore` / `.agentignore`.
 */
const BUILTIN_IGNORED_DIRECTORIES = [".git", "node_modules", "dist", "build", "out", "tmp"] as const

const INCLUDE_DIRECTIVE = "!include "

/**
 * The built-in floor expressed as glob patterns.
 *
 * Exported so scanners that run before any {@link IgnoreController} is available
 * still share this single list instead of redeclaring their own.
 */
export function builtinIgnoreGlobPatterns(): string[] {
	return BUILTIN_IGNORED_DIRECTORIES.map((directory) => `**/${directory}/**`)
}

/**
 * Translate `.gitignore` syntax into glob exclusion patterns.
 *
 * Negations are dropped because a glob ignore list cannot express re-inclusion.
 * Exported so every scanner shares one translation instead of reimplementing it.
 */
export function gitignoreToGlobPatterns(content: string): string[] {
	const patterns: string[] = []
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#") || line.startsWith("!")) continue
		const normalized = line.endsWith("/") ? line.slice(0, -1) : line
		if (!normalized) continue
		const anchored = normalized.startsWith("/")
		const body = anchored ? normalized.slice(1) : normalized
		if (!body) continue
		if (anchored) {
			patterns.push(body, `${body}/**`)
		} else {
			patterns.push(`**/${body}`, `**/${body}/**`)
		}
	}
	return patterns
}

/**
 * Read one directory's `.gitignore` and translate it into glob patterns.
 *
 * Recursive scanners call this for each directory they actually enter, which
 * keeps nested repository rules effective without the upfront full-tree read
 * that exhausted V8 on workspaces holding many nested repositories.
 */
export async function readDirectoryGlobPatterns(directoryPath: string): Promise<string[]> {
	try {
		const content = await fs.readFile(path.join(directoryPath, GIT_IGNORE_FILE), "utf8")
		return gitignoreToGlobPatterns(content)
	} catch {
		return []
	}
}

interface ScopeState {
	instance: Ignore
	/** Raw rules text, or undefined when no rule file contributed content. */
	content: string | undefined
	/** Directory names taken from directory-only patterns, for fast watcher pruning. */
	directoryNames: Set<string>
}

function createScopeState(): ScopeState {
	return { instance: ignore(), content: undefined, directoryNames: new Set() }
}

/**
 * Collect directory names from rules that can only match directories.
 *
 * Only unanchored, wildcard-free directory patterns (`tmp/`, `out/`) are usable
 * as a name-based prune set. Anchored or wildcard patterns stay with the `ignore`
 * instance, which evaluates them against full relative paths.
 */
function collectDirectoryNames(content: string): Set<string> {
	const names = new Set<string>()
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#") || line.startsWith("!")) continue
		if (!line.endsWith("/")) continue
		const candidate = line.slice(0, -1)
		if (!candidate || candidate.includes("/") || candidate.includes("*") || candidate.includes("?")) continue
		names.add(candidate.toLowerCase())
	}
	return names
}

/**
 * Single source of truth for every path-exclusion decision in the workspace.
 *
 * One instance is owned per workspace by the Controller. Before this existed,
 * discovery (`listFiles`), checkpoints, tool access and prompt-input watching each
 * carried their own rules; the watcher in particular hardcoded a short directory
 * list and therefore kept re-scanning directories that discovery could never
 * return, turning every write under an ignored directory into wasted work.
 */
export class IgnoreController {
	private readonly cwd: string
	private readonly scopes: Record<IgnoreScope, ScopeState> = {
		read: createScopeState(),
		git: createScopeState(),
		agent: createScopeState(),
	}
	private readonly changeListeners = new Set<(scope: IgnoreScope) => void>()
	private watcher?: FSWatcher
	private disposed = false
	/** Serializes reloads so a burst of watcher events cannot interleave writes. */
	private reloadQueue: Promise<void> = Promise.resolve()

	constructor(cwd: string) {
		this.cwd = path.resolve(cwd)
	}

	/**
	 * Load the workspace rules once, without watching for later edits.
	 *
	 * For callers that only need a snapshot at one point in time, such as writing
	 * the shadow git exclude file, and would otherwise leak a watcher.
	 */
	static async loadSnapshot(cwd: string): Promise<IgnoreController> {
		const controller = new IgnoreController(cwd)
		await controller.reload()
		return controller
	}

	/** Load every rule file and begin watching them. Call once before use. */
	async initialize(): Promise<void> {
		if (this.disposed) return
		this.setupWatcher()
		await this.reload()
	}

	/**
	 * Raw rules text for one scope, or undefined when no rule file contributed.
	 *
	 * Callers that hand rules to an external process (`rg --ignore-file`) use this;
	 * an undefined result means "no user rules", not "allow nothing".
	 */
	getIgnoreContent(scope: IgnoreScope): string | undefined {
		return this.scopes[scope].content
	}

	/** Report whether a file may be read under one scope. */
	validateAccess(filePath: string, scope: IgnoreScope = "agent", baseDir: string = this.cwd): boolean {
		const relativePath = this.toRelative(filePath, baseDir)
		if (relativePath === undefined) return true
		if (this.isBuiltinIgnoredPath(relativePath)) return false
		const state = this.scopes[scope]
		if (!state.content) return true
		try {
			return !state.instance.ignores(relativePath)
		} catch {
			return true
		}
	}

	/** Report whether a directory may be entered under one scope. */
	validateDirectoryAccess(directoryPath: string, scope: IgnoreScope = "agent", baseDir: string = this.cwd): boolean {
		const relativePath = this.toRelative(directoryPath, baseDir)
		if (relativePath === undefined) return true
		if (this.isBuiltinIgnoredPath(relativePath)) return false
		const state = this.scopes[scope]
		if (!state.content) return true
		try {
			const directoryRelativePath = relativePath.endsWith("/") ? relativePath : `${relativePath}/`
			return !state.instance.ignores(directoryRelativePath)
		} catch {
			return true
		}
	}

	/**
	 * Synchronous directory prune predicate for recursive watchers and scanners.
	 *
	 * Deliberately free of I/O: watcher predicates run for every traversed entry,
	 * so this only consults already-loaded rules.
	 */
	shouldIgnoreDirectory(absolutePath: string, scope: IgnoreScope = "agent"): boolean {
		const resolved = path.resolve(absolutePath)
		if (resolved === this.cwd) return false
		const name = path.basename(resolved).toLowerCase()
		if ((BUILTIN_IGNORED_DIRECTORIES as readonly string[]).includes(name)) return true
		if (this.scopes[scope].directoryNames.has(name)) return true
		return !this.validateDirectoryAccess(resolved, scope)
	}

	/** Terminal command guard: returns the first agent-ignored path an argument reads. */
	validateCommand(command: string, workdirectory: string = this.cwd): string | undefined {
		if (!this.scopes.agent.content) return undefined

		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0]?.toLowerCase()
		if (!baseCommand) return undefined

		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]
		if (!fileReadingCommands.includes(baseCommand)) return undefined

		for (let i = 1; i < parts.length; i++) {
			const argument = parts[i]
			// Skip command flags/options (both Unix and PowerShell style)
			if (argument.startsWith("-") || argument.startsWith("/")) continue
			// Ignore PowerShell parameter names
			if (argument.includes(":")) continue
			if (!this.validateAccess(argument, "agent", workdirectory)) return argument
		}
		return undefined
	}

	/** Keep only the paths readable under one scope. */
	filterPaths(paths: string[], scope: IgnoreScope = "agent"): string[] {
		try {
			return paths.filter((candidate) => this.validateAccess(candidate, scope))
		} catch (error) {
			Logger.error("[IgnoreController] Failed to filter paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Exclusion patterns for glob-based scanners.
	 *
	 * Negated rules are dropped because a glob ignore list cannot express
	 * re-inclusion; scanners must re-check survivors with {@link validateAccess}
	 * when exact fidelity matters.
	 */
	toGlobPatterns(scope: IgnoreScope = "agent"): string[] {
		const patterns = new Set<string>()
		for (const directory of BUILTIN_IGNORED_DIRECTORIES) {
			patterns.add(`**/${directory}/**`)
		}
		const content = this.scopes[scope].content
		if (!content) return [...patterns]

		for (const pattern of gitignoreToGlobPatterns(content)) {
			patterns.add(pattern)
		}
		return [...patterns]
	}

	/** Rules text in `.gitignore` syntax, including the built-in floor. */
	toGitignoreContent(scope: IgnoreScope = "agent"): string {
		const builtin = BUILTIN_IGNORED_DIRECTORIES.map((directory) => `${directory}/`).join("\n")
		const content = this.scopes[scope].content
		return content ? `${builtin}\n${content}` : builtin
	}

	/** Subscribe to committed rule changes. Returns an unsubscribe function. */
	onDidChange(listener: (scope: IgnoreScope) => void): () => void {
		this.changeListeners.add(listener)
		return () => this.changeListeners.delete(listener)
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		const watcher = this.watcher
		this.watcher = undefined
		this.changeListeners.clear()
		if (watcher) await watcher.close()
		await this.reloadQueue.catch(() => undefined)
	}

	/**
	 * Resolve an input path to a cwd-relative POSIX path.
	 *
	 * Returns undefined for anything outside the workspace: those paths carry no
	 * workspace rules, and callers treat them as allowed.
	 */
	private toRelative(inputPath: string, baseDir: string): string | undefined {
		try {
			const normalized = normalizeWorkspaceRelativeInputPath(inputPath)
			const absolutePath = path.resolve(baseDir, normalized)
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()
			if (!relativePath || relativePath.startsWith("../")) return undefined
			return relativePath
		} catch {
			return undefined
		}
	}

	/** Report whether any segment of a relative path is a built-in excluded directory. */
	private isBuiltinIgnoredPath(relativePath: string): boolean {
		const segments = relativePath.split("/")
		// The last segment is only a directory name when the caller passed a
		// trailing slash, so plain files named `out` or `tmp` stay readable.
		const limit = relativePath.endsWith("/") ? segments.length : segments.length - 1
		for (let index = 0; index < limit; index++) {
			const segment = segments[index]?.toLowerCase()
			if (segment && (BUILTIN_IGNORED_DIRECTORIES as readonly string[]).includes(segment)) return true
		}
		return false
	}

	private setupWatcher(): void {
		const watchedFiles = [GIT_IGNORE_FILE, ...AGENT_IGNORE_FILENAMES].map((name) => path.join(this.cwd, name))

		this.watcher = chokidar.watch(watchedFiles, {
			persistent: true,
			ignoreInitial: true,
			atomic: true,
			awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
		})

		const scheduleReload = () => {
			void this.reload().catch((error) => Logger.error("[IgnoreController] Failed to reload ignore rules:", error))
		}
		this.watcher
			.on("add", scheduleReload)
			.on("change", scheduleReload)
			.on("unlink", scheduleReload)
			.on("error", (error) => Logger.error("[IgnoreController] Watcher error:", error))
	}

	/** Rebuild both scopes from disk, serialized against concurrent reloads. */
	private reload(): Promise<void> {
		const run = this.reloadQueue.then(() => this.reloadNow())
		this.reloadQueue = run.catch(() => undefined)
		return run
	}

	private async reloadNow(): Promise<void> {
		if (this.disposed) return
		const startedAt = performance.now()

		const gitContent = await this.readRuleFile(GIT_IGNORE_FILE)

		// Only the highest-precedence agent file contributes: reading several would
		// re-apply rules the workspace believes it replaced.
		let agentRules: string | undefined
		for (const fileName of AGENT_IGNORE_FILENAMES) {
			agentRules = await this.readRuleFile(fileName)
			if (agentRules === undefined) continue
			if (fileName !== AGENT_IGNORE_FILE) {
				Logger.debug(`[IgnoreController] Using ${fileName}; ${AGENT_IGNORE_FILE} is the preferred name.`)
			}
			break
		}

		// Agent rules layer on top of repository rules so a workspace only has to
		// express the difference, including negations that re-admit a path.
		const agentContent =
			gitContent !== undefined && agentRules !== undefined ? `${gitContent}\n${agentRules}` : (agentRules ?? gitContent)

		const changed: IgnoreScope[] = []
		if (this.applyScope("git", gitContent)) changed.push("git")
		if (this.applyScope("agent", agentContent)) changed.push("agent")
		// Read access is governed by agent rules alone. A path excluded only by
		// `.gitignore` stays readable, so generated output and local records such
		// as build artifacts or notes remain available to open.
		if (this.applyScope("read", agentRules)) changed.push("read")

		if (changed.length > 0) {
			Logger.debug(
				`[IgnoreController] Reloaded ${changed.join(", ")} in ${Math.round(performance.now() - startedAt)}ms ` +
					`(git=${gitContent ? "present" : "absent"}, agent=${agentRules ? "present" : "absent"})`,
			)
			for (const scope of changed) this.notify(scope)
		}
	}

	/** Replace one scope's compiled rules. Returns whether the content changed. */
	private applyScope(scope: IgnoreScope, content: string | undefined): boolean {
		const state = this.scopes[scope]
		if (state.content === content) return false
		const instance = ignore()
		if (content) instance.add(content)
		state.instance = instance
		state.content = content
		state.directoryNames = content ? collectDirectoryNames(content) : new Set()
		return true
	}

	private notify(scope: IgnoreScope): void {
		for (const listener of this.changeListeners) {
			try {
				listener(scope)
			} catch (error) {
				Logger.error("[IgnoreController] Change listener failed:", error)
			}
		}
	}

	/** Read one rule file, expanding `!include` directives. Undefined when absent. */
	private async readRuleFile(fileName: string): Promise<string | undefined> {
		const filePath = path.join(this.cwd, fileName)
		try {
			if (!(await fileExistsAtPath(filePath))) return undefined
			const content = await fs.readFile(filePath, "utf8")
			// A rule file always protects itself, matching prior behavior.
			const withSelf = `${content}\n${fileName}`
			if (!content.includes(INCLUDE_DIRECTIVE)) return withSelf
			return `${await this.expandIncludes(content)}\n${fileName}`
		} catch (error) {
			Logger.error(`[IgnoreController] Failed to read ${fileName}:`, error)
			return undefined
		}
	}

	/** Inline `!include <file>` targets, dropping directives whose target is missing. */
	private async expandIncludes(content: string): Promise<string> {
		const lines = content.split(/\r?\n/)
		const expanded: string[] = []
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed.startsWith(INCLUDE_DIRECTIVE)) {
				expanded.push(line)
				continue
			}
			const includePath = trimmed.slice(INCLUDE_DIRECTIVE.length).trim()
			const resolved = path.join(this.cwd, includePath)
			try {
				if (!(await fileExistsAtPath(resolved))) {
					Logger.debug(`[IgnoreController] Included file not found: ${resolved}`)
					continue
				}
				expanded.push(await fs.readFile(resolved, "utf8"))
			} catch (error) {
				Logger.error(`[IgnoreController] Failed to read included file ${resolved}:`, error)
			}
		}
		return expanded.join("\n")
	}
}
