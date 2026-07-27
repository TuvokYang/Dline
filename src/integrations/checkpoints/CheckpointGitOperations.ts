import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { getDlineCheckpointsDir } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { getLfsPatterns, loadWorkspaceIgnoreContent, writeExcludesFile } from "./CheckpointExclusions"
import { type CheckpointRepositoryBoundary, detectCheckpointWorkspaceTopology } from "./CheckpointWorkspaceTopology"

interface CheckpointAddResult {
	success: boolean
}

interface AddCheckpointFilesOptions {
	git: SimpleGit
	mode: "baseline" | "tracked" | "workspace-scan"
	fileList?: string[]
	taskId?: string
}

export interface CheckpointWorktreePath {
	absolute: string
	relative: string
}

function isOutsideDirectory(relativePath: string): boolean {
	return relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
}

/** Prevent Git from interpreting a validated relative file name as a pathspec pattern. */
export function toLiteralGitPathspec(relativePath: string): string {
	return `:(literal)${relativePath}`
}

async function canonicalizeDirectory(directoryPath: string): Promise<string> {
	const absolute = path.resolve(directoryPath)
	let cursor = absolute
	const missingSegments: string[] = []
	while (true) {
		try {
			return path.resolve(await fs.realpath(cursor), ...missingSegments.reverse())
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error
			const parent = path.dirname(cursor)
			if (parent === cursor) throw error
			missingSegments.push(path.basename(cursor))
			cursor = parent
		}
	}
}

/** Resolve one file against the canonical worktree, including symlinked parent directories. */
export async function resolveCheckpointWorktreePath(
	worktree: string,
	filePath: string,
): Promise<CheckpointWorktreePath | undefined> {
	const canonicalWorktree = await canonicalizeDirectory(worktree)
	const absoluteInput = path.resolve(filePath)
	const canonicalParent = await canonicalizeDirectory(path.dirname(absoluteInput))
	const absolute = path.resolve(canonicalParent, path.basename(absoluteInput))
	const relative = path.relative(canonicalWorktree, absolute)
	if (!relative || isOutsideDirectory(relative)) return undefined
	return { absolute, relative: relative.split(path.sep).join("/") }
}

/**
 * GitOperations Class
 *
 * Handles git-specific operations for Cline's Checkpoints system.
 *
 * Key responsibilities:
 * - Git repository initialization and configuration
 * - Git settings management (user, LFS, etc.)
 * - Worktree configuration and management
 * - Excluding nested repository ownership boundaries
 * - File staging and checkpoint creation
 * - Shadow git repository maintenance and cleanup
 */
export class GitOperations {
	private cwd: string
	/** Nested repository boundaries excluded from the root shadow repository. */
	private repositoryBoundaries: CheckpointRepositoryBoundary[] = []

	/**
	 * Creates a new GitOperations instance.
	 *
	 * @param cwd - The current working directory for git operations
	 */
	constructor(cwd: string) {
		this.cwd = cwd
	}

	/**
	 * Initializes or verifies a shadow Git repository for checkpoint tracking.
	 * Creates a new repository if one doesn't exist, or verifies the worktree
	 * configuration if it does.
	 *
	 * Key operations:
	 * - Creates/verifies shadow git repository
	 * - Configures git settings (user, LFS, etc.)
	 * - Sets up worktree to point to workspace
	 *
	 * @param gitPath - Path to the .git directory
	 * @param cwd - The current working directory for git operations
	 * @returns Promise<string> Path to the initialized .git directory
	 * @throws Error if:
	 * - Worktree verification fails for existing repository
	 * - Git initialization or configuration fails
	 * - Unable to create initial commit
	 * - LFS pattern setup fails
	 */
	public async initShadowGit(gitPath: string, cwd: string, taskId: string): Promise<string> {
		Logger.info(`Initializing shadow git`)

		// Load workspace-level ignore rules (.gitignore + .dlineignore) so that
		// directories already ignored by the user (e.g. tmp/) are also excluded
		// from shadow git info/exclude and the nested-git filesystem scan.
		const workspaceIgnoreContent = await loadWorkspaceIgnoreContent(cwd).catch((error) => {
			Logger.warn("CheckpointTracker failed to load workspace ignore files:", error)
			return ""
		})
		const topology = await detectCheckpointWorkspaceTopology(cwd)
		this.repositoryBoundaries = topology.boundaries
		Logger.info(
			`[Task ${taskId}] Checkpoint workspace topology: relation=${topology.repository.relation}, ` +
				`head=${topology.repository.head}, boundaries=${topology.boundaries.length}`,
		)

		// If repo exists, verify it is a shadow git and self-heal config
		if (await fileExistsAtPath(gitPath)) {
			const git = simpleGit(path.dirname(gitPath))

			// Safety: only allow git repos under the dline checkpoints directory.
			// This prevents the checkpoint system from ever operating on real project repos.
			const checkpointsBaseDir = await getDlineCheckpointsDir()
			const normalizedGitPath = path.resolve(gitPath)
			const normalizedBaseDir = path.resolve(checkpointsBaseDir)
			if (!normalizedGitPath.startsWith(normalizedBaseDir + path.sep)) {
				Logger.error(
					`Refusing to use non-shadow git at ${gitPath} for checkpoints. ` +
						`Expected path under ${checkpointsBaseDir}. ` +
						`This protects real project repositories from checkpoint pollution.`,
				)
				throw new Error(
					`Checkpoints can only operate on dedicated shadow repositories. ` +
						`The git at ${gitPath} is not a checkpoint shadow repo.`,
				)
			}

			// Detect incomplete shadow repos (git init was interrupted).
			// An incomplete .git skeleton causes git commands to fall through
			// to parent repositories, polluting real project repos.
			const headPath = path.join(gitPath, "HEAD")
			if (!(await fileExistsAtPath(headPath))) {
				Logger.warn(
					`Shadow git at ${gitPath} is incomplete (missing HEAD) — removing broken skeleton and reinitializing.`,
				)
				await fs.rm(gitPath, { recursive: true, force: true })
				// Fall through to the "initialize new repo" branch below
			} else {
				// Self-heal: ensure shadow git identity markers (user.name/email)
				// are set correctly before any operations.
				await this.ensureShadowGitIdentity(git)

				// Self-heal: ensure core.worktree matches current workspace.
				const worktree = await git.getConfig("core.worktree")
				if (!worktree.value) {
					Logger.warn(`Shadow git core.worktree is not set — configuring to ${cwd}`)
					await git.addConfig("core.worktree", cwd)
				} else if (worktree.value !== cwd) {
					Logger.error(
						`Shadow git core.worktree mismatch: stored="${worktree.value}", current="${cwd}". ` +
							`Auto-correcting to current workspace.`,
					)
					await git.addConfig("core.worktree", cwd)
				}
				Logger.warn(`Using existing shadow git at ${gitPath}`)

				// shadow git repo already exists, but update the excludes just in case
				await writeExcludesFile(
					gitPath,
					await getLfsPatterns(this.cwd),
					workspaceIgnoreContent || undefined,
					topology.exclusionPatterns,
				)
				await this.refreshExistingShadowBaseline(git, taskId)

				return gitPath
			}
		}

		// Initialize new repo
		const startTime = performance.now()
		const checkpointsDir = path.dirname(gitPath)
		Logger.warn(`Creating new shadow git in ${checkpointsDir}`)

		const git = simpleGit(checkpointsDir)
		await git.init()

		// Configure repo with git settings
		await git.addConfig("core.worktree", cwd)
		await git.addConfig("commit.gpgSign", "false")
		await git.addConfig("user.name", "Dline Checkpoint")
		await git.addConfig("user.email", "checkpoint@dline.bot")

		// Set up LFS patterns
		const lfsPatterns = await getLfsPatterns(cwd)
		await writeExcludesFile(gitPath, lfsPatterns, workspaceIgnoreContent || undefined, topology.exclusionPatterns)

		const addFilesResult = await this.addCheckpointFiles({ git, mode: "baseline", taskId })
		if (!addFilesResult.success) {
			Logger.error("Failed to add at least one file(s) to checkpoints shadow git")
			throw new Error("Failed to add at least one file(s) to checkpoints shadow git")
		}

		// Initial commit only on first repo creation
		await git.commit("initial commit", { "--allow-empty": null, "--no-verify": null })

		const durationMs = Math.round(performance.now() - startTime)
		telemetryService.captureCheckpointUsage(taskId, "shadow_git_initialized", durationMs)

		Logger.warn(`Shadow git initialization completed`)

		return gitPath
	}

	/** Rebuild an existing baseline from current exclusions, resetting its index to HEAD on failure. */
	private async refreshExistingShadowBaseline(git: SimpleGit, taskId: string): Promise<void> {
		try {
			const baselineResult = await this.addCheckpointFiles({ git, mode: "baseline", taskId })
			if (!baselineResult.success) {
				throw new Error("Failed to refresh the existing checkpoints shadow baseline")
			}
			if (await this.hasStagedChanges(git, taskId)) {
				await git.commit(`workspace baseline-${taskId}`, { "--no-verify": null })
				Logger.info(`[Task ${taskId}] Refreshed existing checkpoints shadow baseline`)
			}
		} catch (error) {
			try {
				// Initialization never owns staged user work: discard both this
				// attempt and residue left by an older interrupted refresh.
				await git.raw(["read-tree", "--reset", "HEAD"])
			} catch (rollbackError) {
				Logger.error(`[Task ${taskId}] Failed to restore shadow index after baseline refresh failure:`, rollbackError)
			}
			throw error
		}
	}

	/**
	 * Ensures the shadow git identity markers are set to Dline branding.
	 * This prevents commits from leaking the user's global git identity
	 * into checkpoint history. Safe to call before any git commit in a
	 * shadow repository.
	 *
	 * @param git - SimpleGit instance pointing to the shadow git
	 */
	public async ensureShadowGitIdentity(git: SimpleGit): Promise<void> {
		const userName = await git.getConfig("user.name")
		if (userName.value !== "Dline Checkpoint") {
			Logger.warn(`Shadow git user.name is "${userName.value}" — resetting to Dline Checkpoint`)
			await git.addConfig("user.name", "Dline Checkpoint")
		}
		const userEmail = await git.getConfig("user.email")
		if (userEmail.value !== "checkpoint@dline.bot") {
			Logger.warn(`Shadow git user.email is "${userEmail.value}" — resetting to checkpoint@dline.bot`)
			await git.addConfig("user.email", "checkpoint@dline.bot")
		}
	}

	/**
	 * Retrieves the worktree path from the shadow git configuration.
	 * The worktree path indicates where the shadow git repository is tracking files,
	 * which should match the current workspace directory.
	 *
	 * @param gitPath - Path to the .git directory
	 * @returns Promise<string | undefined> The worktree path or undefined if not found
	 * @throws Error if unable to get worktree path
	 */
	public async getShadowGitConfigWorkTree(gitPath: string): Promise<string | undefined> {
		try {
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			return worktree.value || undefined
		} catch (error) {
			Logger.error("Failed to get shadow git config worktree:", error)
			return undefined
		}
	}

	/**
	 * Adds files to the shadow git repository while handling nested git repos.
	 * Uses git commands to list files and stages them for commit.
	 * Respects .gitignore and handles LFS patterns.
	 *
	 * Process:
	 * 1. Uses shadow-repository exclusions for workspace scans
	 * 2. Filters tracked files owned by nested repository boundaries
	 * 3. Stages the remaining explicit files or the root workspace
	 *
	 * @param git - SimpleGit instance configured for the shadow git repo
	 * @param fileList - Optional list of file paths to add. When provided, only
	 *                   these files are staged. When omitted, all files are staged
	 *                   via `git add .` (backward compatible).
	 * @param taskId - Optional task ID for logging purposes
	 * @returns Promise<CheckpointAddResult> Object containing success status
	 * @throws Error if file staging cannot be attempted
	 */
	public async addCheckpointFiles(options: AddCheckpointFilesOptions): Promise<CheckpointAddResult> {
		const { git, mode, fileList, taskId } = options
		const explicitFiles = fileList ?? []
		const startTime = performance.now()
		if (mode === "tracked" && explicitFiles.length === 0) {
			Logger.error(`[Task ${taskId}] tracked checkpoint add requires explicit files`)
			return { success: false }
		}
		if ((mode === "baseline" || mode === "workspace-scan") && explicitFiles.length > 0) {
			Logger.error(`[Task ${taskId}] ${mode} checkpoint add must not receive explicit fileList`)
			return { success: false }
		}
		Logger.info(`[Task ${taskId}] Starting checkpoint add operation (${mode})...`)
		try {
			if (mode === "tracked") {
				const resolvedFiles = await Promise.all(
					explicitFiles.map((file) => resolveCheckpointWorktreePath(this.cwd, file)),
				)
				if (resolvedFiles.some((file) => file === undefined)) {
					Logger.error(`[Task ${taskId}] Checkpoint add rejected a tracked path outside ${this.cwd}`)
					return { success: false }
				}
				const ownedFiles = resolvedFiles as CheckpointWorktreePath[]
				const safeFiles = ownedFiles.filter((file) => !this.isRepositoryBoundaryFile(file.absolute)) as Array<{
					absolute: string
					relative: string
				}>
				if (safeFiles.length === 0) {
					Logger.warn(
						`[Task ${taskId}] Checkpoint add skipped: all tracked files belong to nested repository boundaries`,
					)
					return { success: false }
				}
				if (safeFiles.length !== ownedFiles.length) {
					Logger.warn(
						`[Task ${taskId}] Checkpoint add excluded ${ownedFiles.length - safeFiles.length} nested repository file(s)`,
					)
				}

				const existence = await Promise.all(safeFiles.map((file) => fileExistsAtPath(file.absolute)))
				const missingFiles = safeFiles.filter((_file, index) => !existence[index])
				let indexedPaths = new Set<string>()
				if (missingFiles.length > 0) {
					const output = await git.raw(["ls-files", "-z"])
					indexedPaths = new Set(
						output
							.split("\0")
							.filter(Boolean)
							.map((file) => this.normalizeGitPath(file)),
					)
				}
				const stageFiles = safeFiles.filter(
					(file, index) => existence[index] || indexedPaths.has(this.normalizeGitPath(file.relative)),
				)
				if (stageFiles.length === 0) {
					Logger.warn(`[Task ${taskId}] Checkpoint add skipped: no tracked path exists in the worktree or shadow index`)
					return { success: true }
				}
				if (stageFiles.length !== safeFiles.length) {
					Logger.warn(
						`[Task ${taskId}] Checkpoint add ignored ${safeFiles.length - stageFiles.length} path(s) absent from both worktree and shadow index`,
					)
				}
				await git.add(["-A", "-f", "--", ...stageFiles.map((file) => toLiteralGitPathspec(file.relative))])
				Logger.debug(`[Task ${taskId}] Checkpoint add operation: staged ${stageFiles.length} tracked file(s)`)
			} else {
				if (mode === "baseline") {
					// Rebuild the complete index so newly ignored or newly excluded files
					// are removed from the current baseline as well as omitted from additions.
					await git.raw(["read-tree", "--empty"])
				}
				await git.add([".", "--ignore-errors"])
				Logger.debug(`[Task ${taskId}] Checkpoint add operation: staged workspace via ${mode}`)
			}
			const durationMs = Math.round(performance.now() - startTime)
			Logger.debug(`Checkpoint add operation completed in ${durationMs}ms`)
			return { success: true }
		} catch (error) {
			Logger.error(`[Task ${taskId}] Checkpoint add operation failed (${mode}):`, error)
			return { success: false }
		}
	}

	private isRepositoryBoundaryFile(filePath: string): boolean {
		const absolutePath = path.resolve(filePath)
		return this.repositoryBoundaries.some((boundary) => {
			const boundaryPath = path.resolve(this.cwd, boundary.relativePath)
			const relative = path.relative(boundaryPath, absolutePath)
			return relative === "" || !isOutsideDirectory(relative)
		})
	}

	private normalizeGitPath(filePath: string): string {
		const normalized = filePath.replaceAll("\\", "/")
		return process.platform === "win32" ? normalized.toLowerCase() : normalized
	}

	/**
	 * Check whether the shadow git worktree has unstaged or untracked changes.
	 *
	 * @param git SimpleGit instance configured for the shadow repository.
	 * @param taskId Optional task ID for logging.
	 * @returns true when workspace changes exist.
	 */
	public async hasWorkspaceChanges(git: SimpleGit, taskId?: string): Promise<boolean> {
		try {
			const output = await git.raw(["status", "--porcelain", "--untracked-files=all"])
			const hasChanges = output.trim().length > 0
			Logger.debug(`[Task ${taskId}] Workspace change preflight: ${hasChanges ? "changes detected" : "clean"}`)
			return hasChanges
		} catch (error) {
			Logger.warn(`[Task ${taskId}] Workspace change preflight failed; assuming changes exist:`, error)
			return true
		}
	}

	/**
	 * Check whether the shadow git index has staged changes ready to commit.
	 *
	 * @param git SimpleGit instance configured for the shadow repository.
	 * @param taskId Optional task ID for logging.
	 * @returns true when staged changes exist.
	 */
	public async hasStagedChanges(git: SimpleGit, taskId?: string): Promise<boolean> {
		try {
			const output = await git.raw(["diff", "--cached", "--name-only"])
			const hasChanges = output.trim().length > 0
			Logger.debug(
				`[Task ${taskId}] ${hasChanges ? "Staged checkpoint changes detected" : "No staged checkpoint changes detected"}`,
			)
			return hasChanges
		} catch (error) {
			Logger.warn(`[Task ${taskId}] Failed to inspect staged checkpoint changes:`, error)
			return true
		}
	}
}
