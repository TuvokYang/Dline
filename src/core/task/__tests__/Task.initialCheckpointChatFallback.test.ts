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
		const fileCommitGuard = requestBoundary.slice(
			requestBoundary.indexOf("if (lastCheckpointMessageIndex !== -1", chatCheckpointIndex),
			requestBoundary.indexOf("const commitPromise", chatCheckpointIndex),
		)

		expect(chatCheckpointIndex).toBeGreaterThanOrEqual(0)
		expect(chatCheckpointGuard).toContain("this.checkpointManager")
		expect(chatCheckpointGuard).not.toContain("checkpointManagerErrorMessage")
		expect(fileCommitGuard).toContain("!this.taskState.checkpointManagerErrorMessage")
	})
})
