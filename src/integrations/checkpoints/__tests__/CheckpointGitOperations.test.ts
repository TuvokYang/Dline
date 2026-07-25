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
		const workspacePath = path.resolve("checkpoint-test-workspace")
		const operations = new GitOperations(workspacePath)
		configureNestedRepositoryBoundary(operations, "packages/nested")
		const harness = createGitHarness()
		const rootFile = path.join(workspacePath, "src", "root.ts")
		const nestedFile = path.join(workspacePath, "packages", "nested", "src", "owned.ts")

		const result = await operations.addCheckpointFiles({
			git: harness.git,
			mode: "tracked",
			fileList: [rootFile, nestedFile],
			taskId: "task-1",
		})

		expect(result).toEqual({ success: true })
		expect(harness.add).toHaveBeenCalledOnce()
		expect(harness.add).toHaveBeenCalledWith(["-f", rootFile])
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
