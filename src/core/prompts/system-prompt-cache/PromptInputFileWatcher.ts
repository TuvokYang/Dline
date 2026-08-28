import path from "node:path"
import { Logger } from "@shared/services/Logger"
import chokidar, { type ChokidarOptions, type FSWatcher } from "chokidar"

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".svn", ".hg", "node_modules", "dist", "out", "build", "coverage"])

export interface PromptInputFileWatcherDeps {
	readonly cwd: string
	readonly globalRulesDirectory: string
	readonly workflowDirectories: readonly string[]
	readonly skillDirectories: readonly string[]
	readonly subagentDirectories: readonly string[]
	readonly invalidate: () => void
	readonly watch?: (paths: readonly string[], options: ChokidarOptions) => FSWatcher
}

function isWithin(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function normalizedParts(parent: string, candidate: string): string[] | undefined {
	if (!isWithin(parent, candidate)) return undefined
	const relative = path.relative(parent, candidate)
	if (!relative) return []
	return relative.split(path.sep).filter(Boolean)
}

function resolveUnique(paths: readonly string[]): string[] {
	return Array.from(new Set(paths.map((candidate) => path.resolve(candidate))))
}

/** Watch local files whose canonical discovery projection can affect a frozen prompt or tool snapshot. */
export class PromptInputFileWatcher {
	private readonly cwd: string
	private readonly globalRulesDirectory: string
	private readonly workflowDirectories: readonly string[]
	private readonly skillDirectories: readonly string[]
	private readonly subagentDirectories: readonly string[]
	private readonly protectedDirectories: readonly string[]
	private readonly watchRoots: readonly string[]
	private readonly invalidate: () => void
	private readonly watch: (paths: readonly string[], options: ChokidarOptions) => FSWatcher
	private watcher?: FSWatcher
	private disposed = false

	constructor(deps: PromptInputFileWatcherDeps) {
		this.cwd = path.resolve(deps.cwd)
		this.globalRulesDirectory = path.resolve(deps.globalRulesDirectory)
		this.workflowDirectories = resolveUnique(deps.workflowDirectories)
		this.skillDirectories = resolveUnique(deps.skillDirectories)
		this.subagentDirectories = resolveUnique(deps.subagentDirectories)
		this.protectedDirectories = resolveUnique([
			this.globalRulesDirectory,
			path.join(this.cwd, ".dline", "rules"),
			path.join(this.cwd, ".cursor", "rules"),
			...this.workflowDirectories,
			...this.skillDirectories,
			...this.subagentDirectories,
		])
		this.watchRoots = resolveUnique([
			this.cwd,
			this.globalRulesDirectory,
			...this.workflowDirectories,
			...this.skillDirectories,
			...this.subagentDirectories,
		])
		this.invalidate = deps.invalidate
		this.watch = deps.watch ?? ((paths, options) => chokidar.watch([...paths], options))
	}

	async start(): Promise<void> {
		if (this.disposed || this.watcher) return
		const watcher = this.watch(this.watchRoots, {
			persistent: true,
			ignoreInitial: true,
			atomic: true,
			awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
			ignored: (candidate, stats) => stats?.isDirectory() === true && this.shouldIgnoreDirectory(candidate),
		})
		this.watcher = watcher
		const handle = (candidate: unknown) => {
			if (this.disposed || typeof candidate !== "string" || !this.isPromptVisibleInput(candidate)) return
			this.invalidate()
		}
		watcher
			.on("add", handle)
			.on("change", handle)
			.on("unlink", handle)
			.on("error", (error) => {
				Logger.error("[PromptInputFileWatcher] Failed to watch prompt-visible inputs:", error)
			})
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		const watcher = this.watcher
		this.watcher = undefined
		if (watcher) await watcher.close()
	}

	private shouldIgnoreDirectory(candidate: string): boolean {
		if (!IGNORED_DIRECTORY_NAMES.has(path.basename(candidate).toLowerCase())) return false
		const resolved = path.resolve(candidate)
		return !this.protectedDirectories.some((directory) => isWithin(directory, resolved))
	}

	private isPromptVisibleInput(candidate: string): boolean {
		const resolved = path.resolve(candidate)
		return (
			this.isRuleInput(resolved) ||
			this.isWorkflowInput(resolved) ||
			this.isSkillInput(resolved) ||
			this.isSubagentInput(resolved)
		)
	}

	private isRuleInput(candidate: string): boolean {
		if (isWithin(this.globalRulesDirectory, candidate)) return true
		if (!isWithin(this.cwd, candidate)) return false
		const normalized = path.relative(this.cwd, candidate).split(path.sep).join("/").toLowerCase()
		if (normalized === ".cursorrules" || normalized === ".windsurfrules") return true
		if (normalized.startsWith(".dline/rules/")) return true
		if (normalized.startsWith(".cursor/rules/") && normalized.endsWith(".mdc")) return true
		return path.basename(candidate).toLowerCase() === "agents.md"
	}

	private isWorkflowInput(candidate: string): boolean {
		if (!/\.(md|mdx)$/i.test(candidate)) return false
		return this.workflowDirectories.some((directory) => isWithin(directory, candidate))
	}

	private isSkillInput(candidate: string): boolean {
		if (path.basename(candidate).toLowerCase() !== "skill.md") return false
		return this.skillDirectories.some((directory) => normalizedParts(directory, candidate)?.length === 2)
	}

	private isSubagentInput(candidate: string): boolean {
		if (!/\.(yaml|yml)$/i.test(candidate)) return false
		return this.subagentDirectories.some((directory) => normalizedParts(directory, candidate)?.length === 1)
	}
}
