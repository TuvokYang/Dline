import fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GitOperations } from "../CheckpointGitOperations"
import CheckpointTracker from "../CheckpointTracker"
import { getShadowGitPath, hashWorkingDir } from "../CheckpointUtils"
import { TaskFileTracker } from "../TaskFileTracker"

function createGitHarness(): { git: SimpleGit; add: ReturnType<typeof vi.fn> } {
	const add = vi.fn().mockResolvedValue(undefined)
	return {
		git: { add } as unknown as SimpleGit,
		add,
	}
}

function configureNestedRepositoryBoundary(operations: GitOperations, relativePath: string): void {
	Object.assign(operations, {
		repositoryBoundaries: [
			{
				relativePath,
				kind: "nested_repo",
				initialized: true,
				head: "committed",
			},
		],
	})
}

describe("CheckpointTracker baseline checkpoints", () => {
	it("returns a restorable shadow hash for an unborn user repository before any task files are tracked", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dline-unborn-checkpoint-"))
		const workspacePath = path.join(sandbox, "workspace")
		const documentsPath = path.join(sandbox, "documents")
		const previousDocumentsPath = process.env.DLINE_DOCS_DIR
		process.env.DLINE_DOCS_DIR = documentsPath
		await fs.mkdir(workspacePath, { recursive: true })
		await fs.writeFile(path.join(workspacePath, "initial.txt"), "baseline")
		await simpleGit(workspacePath).init()

		try {
			const tracker = await CheckpointTracker.create("task-unborn", true, workspacePath)
			if (!tracker) throw new Error("checkpoint_tracker_missing")
			tracker.setTaskFileTracker(new TaskFileTracker("task-unborn"))

			const checkpointHash = await tracker.commit()
			const shadowGitPath = await getShadowGitPath(hashWorkingDir(workspacePath))
			const shadowGit = simpleGit(path.dirname(shadowGitPath))
			const shadowHead = await shadowGit.revparse(["HEAD"])
			const userBranch = await simpleGit(workspacePath).branchLocal()

			expect(checkpointHash).toBe(shadowHead.trim())
			expect(userBranch.current).toBe("")
		} finally {
			if (previousDocumentsPath === undefined) delete process.env.DLINE_DOCS_DIR
			else process.env.DLINE_DOCS_DIR = previousDocumentsPath
			await fs.rm(sandbox, { recursive: true, force: true })
		}
	})
})

describe("GitOperations repository boundaries", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("stages root files while excluding tracked files owned by a nested repository", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dline-checkpoint-boundary-"))
		const workspacePath = path.join(sandbox, "workspace")
		const rootFile = path.join(workspacePath, "src", "root.ts")
		const nestedFile = path.join(workspacePath, "packages", "nested", "src", "owned.ts")
		await fs.mkdir(path.dirname(rootFile), { recursive: true })
		await fs.mkdir(path.dirname(nestedFile), { recursive: true })
		await fs.writeFile(rootFile, "root")
		await fs.writeFile(nestedFile, "nested")
		try {
			const operations = new GitOperations(workspacePath)
			configureNestedRepositoryBoundary(operations, "packages/nested")
			const harness = createGitHarness()

			const result = await operations.addCheckpointFiles({
				git: harness.git,
				mode: "tracked",
				fileList: [rootFile, nestedFile],
				taskId: "task-1",
			})

			expect(result).toEqual({ success: true })
			expect(harness.add).toHaveBeenCalledOnce()
			expect(harness.add).toHaveBeenCalledWith(["-A", "-f", "--", ":(literal)src/root.ts"])
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true })
		}
	})

	it("does not stage or mutate metadata when every tracked file belongs to a repository boundary", async () => {
		const workspacePath = path.resolve("checkpoint-test-workspace")
		const operations = new GitOperations(workspacePath)
		configureNestedRepositoryBoundary(operations, "packages/nested")
		const harness = createGitHarness()
		const nestedFile = path.join(workspacePath, "packages", "nested", "src", "owned.ts")

		const result = await operations.addCheckpointFiles({
			git: harness.git,
			mode: "tracked",
			fileList: [nestedFile],
			taskId: "task-1",
		})

		expect(result).toEqual({ success: false })
		expect(harness.add).not.toHaveBeenCalled()
	})

	it("rejects a worktree path whose parent symlink resolves outside the worktree", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dline-checkpoint-symlink-"))
		const workspacePath = path.join(sandbox, "workspace")
		const outsidePath = path.join(sandbox, "outside")
		const linkedPath = path.join(workspacePath, "linked-outside")
		await fs.mkdir(workspacePath, { recursive: true })
		await fs.mkdir(outsidePath, { recursive: true })
		await fs.writeFile(path.join(outsidePath, "owned.ts"), "outside")
		await fs.symlink(outsidePath, linkedPath, process.platform === "win32" ? "junction" : "dir")
		try {
			const operations = new GitOperations(workspacePath)
			const harness = createGitHarness()

			const result = await operations.addCheckpointFiles({
				git: harness.git,
				mode: "tracked",
				fileList: [path.join(linkedPath, "owned.ts")],
				taskId: "task-symlink",
			})

			expect(result).toEqual({ success: false })
			expect(harness.add).not.toHaveBeenCalled()
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true })
		}
	})

	it("accepts a legal worktree child whose first segment starts with two dots", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dline-checkpoint-dot-segment-"))
		const workspacePath = path.join(sandbox, "workspace")
		const trackedFile = path.join(workspacePath, "..cache", "tracked.ts")
		await fs.mkdir(path.dirname(trackedFile), { recursive: true })
		await fs.writeFile(trackedFile, "tracked")
		try {
			const operations = new GitOperations(workspacePath)
			const harness = createGitHarness()

			const result = await operations.addCheckpointFiles({
				git: harness.git,
				mode: "tracked",
				fileList: [trackedFile],
				taskId: "task-dot-segment",
			})

			expect(result).toEqual({ success: true })
			expect(harness.add).toHaveBeenCalledOnce()
			expect(harness.add).toHaveBeenCalledWith(["-A", "-f", "--", ":(literal)..cache/tracked.ts"])
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true })
		}
	})

	it.each(["EACCES", "ELOOP"])("fails closed when canonical path resolution returns %s", async (code) => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dline-checkpoint-realpath-error-"))
		const workspacePath = path.join(sandbox, "workspace")
		const trackedFile = path.join(workspacePath, "tracked.ts")
		await fs.mkdir(workspacePath, { recursive: true })
		await fs.writeFile(trackedFile, "tracked")
		vi.spyOn(fs, "realpath").mockRejectedValue(Object.assign(new Error(code), { code }))
		try {
			const operations = new GitOperations(workspacePath)
			const harness = createGitHarness()

			const result = await operations.addCheckpointFiles({
				git: harness.git,
				mode: "tracked",
				fileList: [trackedFile],
				taskId: `task-realpath-${code.toLowerCase()}`,
			})

			expect(result).toEqual({ success: false })
			expect(harness.add).not.toHaveBeenCalled()
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true })
		}
	})

	it("uses shadow exclude rules for workspace scans instead of per-boundary staging", async () => {
		const operations = new GitOperations(path.resolve("checkpoint-test-workspace"))
		const harness = createGitHarness()

		const result = await operations.addCheckpointFiles({
			git: harness.git,
			mode: "workspace-scan",
			taskId: "task-1",
		})

		expect(result).toEqual({ success: true })
		expect(harness.add).toHaveBeenCalledWith([".", "--ignore-errors"])
	})
})
