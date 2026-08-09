import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

describe("Task prompt cache request boundary", () => {
	it("guards canceled requests before recording final prompt cache usage", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const finalizationIndex = source.indexOf("// Update the api_req_started message with final usage and cost details")
		const storedResponseIndex = source.indexOf(
			"// Stored the assistant API response immediately after the stream finishes",
			finalizationIndex,
		)

		expect(finalizationIndex).toBeGreaterThanOrEqual(0)
		expect(storedResponseIndex).toBeGreaterThan(finalizationIndex)

		const finalUsageBoundary = source.slice(finalizationIndex, storedResponseIndex)
		const historyUpdateIndex = finalUsageBoundary.indexOf("await this.messageStateHandler.updateTaskHistory()")
		const abortGuardIndex = finalUsageBoundary.indexOf("if (this.taskState.abort)")
		const cacheObservationIndex = finalUsageBoundary.indexOf("this.promptCacheHealth.recordRequest({")
		const stateProjectionIndex = finalUsageBoundary.indexOf("await this.postStateToWebview()")

		expect(historyUpdateIndex).toBeGreaterThanOrEqual(0)
		expect(abortGuardIndex).toBeGreaterThan(historyUpdateIndex)
		expect(cacheObservationIndex).toBeGreaterThan(abortGuardIndex)
		expect(stateProjectionIndex).toBeGreaterThan(cacheObservationIndex)
	})
})
