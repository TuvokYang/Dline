import { readFile } from "fs/promises"
import path from "path"
import { describe, expect, it } from "vitest"

/**
 * `startTask` runs before the first `say`, so every await inside it is invisible
 * in production logs. `refreshStableContextWindowIndicator` builds full
 * environment details (host version, visible tabs, open tabs, active task
 * controllers) purely to refresh a header readout, and nothing downstream reads
 * its result. Awaiting it delayed the first provider request on large
 * workspaces, which is why it must stay off the startup critical path.
 */
describe("Task startup blocking", () => {
	const taskSourcePath = path.resolve(__dirname, "../index.ts")

	async function readStartTaskBody(): Promise<string> {
		const source = await readFile(taskSourcePath, "utf8")
		const start = source.indexOf("public async startTask(")
		expect(start).toBeGreaterThan(-1)
		const end = source.indexOf('await this.say("task"', start)
		expect(end).toBeGreaterThan(start)
		return source.slice(start, end)
	}

	it("does not await the stable context-window indicator before the first say", async () => {
		const body = await readStartTaskBody()

		expect(body).not.toContain("await this.refreshStableContextWindowIndicator()")
		expect(body).toContain("void this.refreshStableContextWindowIndicator()")
	})

	it("keeps the background refresh failure-tolerant", async () => {
		const body = await readStartTaskBody()

		const refreshIndex = body.indexOf("void this.refreshStableContextWindowIndicator()")
		const catchIndex = body.indexOf(".catch(", refreshIndex)

		expect(catchIndex).toBeGreaterThan(refreshIndex)
	})

	it("reports startup segment timings so a stall is attributable from logs", async () => {
		const body = await readStartTaskBody()

		expect(body).toContain("startTask timing:")
		expect(body).toContain("rateMetrics=")
		expect(body).toContain("clineIgnore=")
	})

	/**
	 * The checkpoint baseline must capture the workspace before the model can edit
	 * any file, but provider inference itself is read-only. Initialization can run
	 * concurrently with the first request as long as every mutating tool awaits the
	 * durable baseline promise before execution.
	 */
	it("does not await checkpoint initialization before the first provider request", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const start = source.indexOf("async recursivelyMakeClineRequests(")
		expect(start).toBeGreaterThan(-1)
		const end = source.indexOf("// Determine if we should compact context window", start)
		expect(end).toBeGreaterThan(start)
		const method = source.slice(start, end)

		expect(method).toContain("checkpointInitializationPromise = ensureCheckpointInitialized({ checkpointManager })")
		expect(method).not.toContain("await ensureCheckpointInitialized(")
		expect(method).toContain("this.initialCheckpointCommitPromise = persistCommitPromise")
	})

	it("still awaits the initial checkpoint before a non-read-only tool executes", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const gate = source.indexOf("if (this.initialCheckpointCommitPromise && !READ_ONLY_TOOLS.includes")
		expect(gate).toBeGreaterThan(-1)
		const awaitCommit = source.indexOf("await this.initialCheckpointCommitPromise", gate)
		expect(awaitCommit).toBeGreaterThan(gate)
	})
})
