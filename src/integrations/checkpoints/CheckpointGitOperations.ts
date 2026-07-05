import { fileExistsAtPath } from "@utils/fs"
import { retryWithBackoff } from "@utils/retry"
import fs from "fs/promises"
import { globby } from "globby"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { getDlineCheckpointsDir } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import {
	GIT_DISABLED_SUFFIX,
	getExcludedDirectoryGlobs,
	getLfsPatterns,
	loadWorkspaceIgnoreContent,
	parseGitignoreToGlobs,
	writeExcludesFile,
} from "./CheckpointExclusions"

interface CheckpointAddResult {
	success: boolean
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
 * - Managing nested git repositories during checkpoint operations
 * - File staging and checkpoint creation
 * - Shadow git repository maintenance and cleanup
 */
export class GitOperations {
	private cwd: string
	/** Cached globby-compatible ignore patterns parsed from workspace .gitignore / .dlineignore */
	private workspaceGlobIgnorePatterns: string[] = []

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
		this.workspaceGlobIgnorePatterns = workspaceIgnoreContent ? parseGitignoreToGlobs(workspaceIgnoreContent) : []

		// Clean up any leftover .git_disabled directories from a previous crash/interruption.
		// If addCheckpointFiles() was interrupted mid disable/enable cycle, nested repos may still be disabled.
		await this.renameNestedGitRepos(false, [], taskId).catch((error) => {
			Logger.warn("CheckpointTracker failed best-effort nested git cleanup during shadow git init:", error)
		})

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
				await writeExcludesFile(gitPath, await getLfsPatterns(this.cwd), workspaceIgnoreContent || undefined)

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
		await writeExcludesFile(gitPath, lfsPatterns, workspaceIgnoreContent || undefined)

		const addFilesResult = await this.addCheckpointFiles(git, undefined, taskId)
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
	 * Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's
	 * requirement of using submodules for nested repos.
	 *
	 * This method renames nested .git directories by adding/removing a suffix to temporarily disable/enable them.
	 * The root .git directory is preserved. Uses VS Code's workspace API to find nested .git directories and
	 * only processes actual directories (not files named .git).
	 *
	 * @param disable - If true, adds suffix to disable nested git repos. If false, removes suffix to re-enable them.
	 * @param excludeDirs - Additional directories to exclude from the search
	 * @param taskId - Optional task ID for logging purposes
	 * @throws Error if renaming any .git directory fails
	 */
	public async renameNestedGitRepos(disable: boolean, excludeDirs: string[] = [], taskId?: string) {
		// Build ignore list: root .git, excluded directories from shadow git's
		// info/exclude rules, workspace .gitignore/.dlineignore globs, and any
		// caller-supplied ignore patterns.
		const ignorePatterns = [".git", ...getExcludedDirectoryGlobs(this.workspaceGlobIgnorePatterns), ...excludeDirs]

		const gitPaths = await globby(`**/.git${disable ? "" : GIT_DISABLED_SUFFIX}`, {
			cwd: this.cwd,
			onlyDirectories: true,
			ignore: ignorePatterns,
			dot: true,
			markDirectories: false,
			suppressErrors: true,
		})

		// For each nested .git directory, rename it based on operation
		for (const gitPath of gitPaths) {
			const fullPath = path.join(this.cwd, gitPath)
			let newPath: string
			if (disable) {
				newPath = fullPath + GIT_DISABLED_SUFFIX
			} else {
				newPath = fullPath.endsWith(GIT_DISABLED_SUFFIX) ? fullPath.slice(0, -GIT_DISABLED_SUFFIX.length) : fullPath
			}

			try {
				await fs.rename(fullPath, newPath)
				Logger.log(`[Task ${taskId}] CheckpointTracker ${disable ? "disabled" : "enabled"} nested git repo ${gitPath}`)
			} catch (error) {
				const errCode = (error as NodeJS.ErrnoException)?.code
				// EPERM / EBUSY on Windows means another process holds the directory.
				// Skip this entry so one stuck directory does not block all others.
				if (errCode === "EPERM" || errCode === "EBUSY") {
					Logger.warn(
						`[Task ${taskId}] CheckpointTracker cannot ${disable ? "disable" : "enable"} nested git repo ${gitPath}: ${errCode} (skipped)`,
					)
					continue
				}
				Logger.error(
					`[Task ${taskId}] CheckpointTracker failed to ${disable ? "disable" : "enable"} nested git repo ${gitPath}:`,
					error,
				)
				throw new Error(
					`Failed to ${disable ? "disable" : "enable"} nested git repo ${gitPath}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}
	}

	/**
	 * Adds files to the shadow git repository while handling nested git repos.
	 * Uses git commands to list files and stages them for commit.
	 * Respects .gitignore and handles LFS patterns.
	 *
	 * Process:
	 * 1. Updates exclude patterns from LFS config
	 * 2. Temporarily disables nested git repos
	 * 3. Stages files for commit (specific files or all files)
	 * 4. Re-enables nested git repos
	 *
	 * @param git - SimpleGit instance configured for the shadow git repo
	 * @param fileList - Optional list of file paths to add. When provided, only
	 *                   these files are staged. When omitted, all files are staged
	 *                   via `git add .` (backward compatible).
	 * @param taskId - Optional task ID for logging purposes
	 * @returns Promise<CheckpointAddResult> Object containing success status
	 * @throws Error if:
	 *  - File operations fail
	 *  - Git commands error
	 *  - LFS pattern updates fail
	 *  - Nested git repo handling fails
	 */
	public async addCheckpointFiles(git: SimpleGit, fileList?: string[], taskId?: string): Promise<CheckpointAddResult> {
		const startTime = performance.now()
		try {
			// Update exclude patterns before each commit
			await this.renameNestedGitRepos(true, [], taskId)
			Logger.info(`[Task ${taskId}] Starting checkpoint add operation...`)

			try {
				if (fileList && fileList.length > 0) {
					// Stage only specified files for per-file checkpointing.
					// Use -f to force-add files that match info/exclude rules —
					// these files were explicitly modified by tool handlers and
					// should be checkpointed regardless of exclusion patterns.
					await git.add(["-f", ...fileList])
					Logger.debug(`[Task ${taskId}] Checkpoint add operation: staged ${fileList.length} file(s) with -f`)
				} else {
					// Backward compatible: stage all files.
					// Any files with permissions errors will not be added,
					// but the process will proceed and add the rest (--ignore-errors).
					await git.add([".", "--ignore-errors"])
				}
				const durationMs = Math.round(performance.now() - startTime)
				Logger.debug(`Checkpoint add operation completed in ${durationMs}ms`)
				return { success: true }
			} catch (_error) {
				return { success: false }
			}
		} catch (_error) {
			return { success: false }
		} finally {
			await retryWithBackoff(() => this.renameNestedGitRepos(false, [], taskId), {
				operationName: "CheckpointTracker re-enable nested git repos",
				maxAttempts: 3,
				baseDelayMs: 50,
				onRetry: (_error, attempt, maxAttempts, delayMs) => {
					Logger.warn(
						`[Task ${taskId}] CheckpointTracker re-enable nested git repos failed on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms`,
					)
				},
			}).catch((error) => {
				Logger.error(`[Task ${taskId}] CheckpointTracker failed to re-enable nested git repos after retries:`, error)
			})
		}
	}
}
