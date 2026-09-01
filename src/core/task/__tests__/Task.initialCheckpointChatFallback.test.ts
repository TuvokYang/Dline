import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractRequestBoundary(source: string): string {
	const start = source.indexOf("async recursivelyMakeClineRequests(")
	const end = source.indexOf("\n\tasync loadContext(", start)
	if (start < 0 || end < 0) {
		throw new Error("Unable to locate Task request boundary")
	}
	return source.slice(start, end)
}

describe("Task initial chat checkpoint fallback", () => {
	it("creates the chat checkpoint without requiring the Git checkpoint backend to be healthy", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestBoundary = extractRequestBoundary(source)
		const chatCheckpointIndex = requestBoundary.indexOf('await this.say("checkpoint_created")')
		const chatCheckpointGuardStart = requestBoundary.lastIndexOf("\n\t\tif (", chatCheckpointIndex)
		const chatCheckpointGuard = requestBoundary.slice(chatCheckpointGuardStart, chatCheckpointIndex)
		const fileCommitGuardStart = requestBoundary.indexOf("if (checkpointInitializationPromise)", chatCheckpointIndex)
		const fileCommitGuard = requestBoundary.slice(
			fileCommitGuardStart,
			requestBoundary.indexOf("const persistCommitPromise", fileCommitGuardStart),
		)

		expect(chatCheckpointIndex).toBeGreaterThanOrEqual(0)
		expect(chatCheckpointGuard).toContain("checkpointsEnabled && checkpointManager")
		expect(chatCheckpointGuard).not.toContain("checkpointManagerErrorMessage")
		expect(fileCommitGuardStart).toBeGreaterThan(chatCheckpointIndex)
		expect(fileCommitGuard).toContain("checkpointInitializationPromise")
	})
})
