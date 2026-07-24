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
		const startTime = performance.now()
		if (mode === "tracked" && (!fileList || fileList.length === 0)) {
			Logger.error(`[Task ${taskId}] tracked checkpoint add requires explicit files`)
			return { success: false }
		}
		if ((mode === "baseline" || mode === "workspace-scan") && fileList && fileList.length > 0) {
			Logger.error(`[Task ${taskId}] ${mode} checkpoint add must not receive explicit fileList`)
			return { success: false }
		}
		Logger.info(`[Task ${taskId}] Starting checkpoint add operation (${mode})...`)
		try {
			if (mode === "tracked") {
				const safeFiles = fileList!.filter((file) => !this.isRepositoryBoundaryFile(file))
				if (safeFiles.length === 0) {
					Logger.warn(
						`[Task ${taskId}] Checkpoint add skipped: all tracked files belong to nested repository boundaries`,
					)
					return { success: false }
				}
				if (safeFiles.length !== fileList!.length) {
					Logger.warn(
						`[Task ${taskId}] Checkpoint add excluded ${fileList!.length - safeFiles.length} nested repository file(s)`,
					)
				}
				await git.add(["-f", ...safeFiles])
				Logger.debug(`[Task ${taskId}] Checkpoint add operation: staged ${safeFiles.length} tracked file(s) with -f`)
			} else {
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
			return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
		})
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
			await git.raw(["diff", "--cached", "--quiet"])
			Logger.debug(`[Task ${taskId}] No staged checkpoint changes detected`)
			return false
		} catch {
			Logger.debug(`[Task ${taskId}] Staged checkpoint changes detected`)
			return true
		}
	}
}
