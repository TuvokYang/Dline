import * as path from "path"
import type { SimpleGit } from "simple-git"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GitOperations } from "../CheckpointGitOperations"

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
