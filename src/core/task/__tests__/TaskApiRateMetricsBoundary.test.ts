import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractMethod(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker)
	const end = source.indexOf(endMarker, start)
	if (start < 0 || end < 0) throw new Error(`Unable to locate Task metrics boundary: ${startMarker}`)
	return source.slice(start, end)
}

function expectContains(source: string, expected: string): void {
	expect(source.includes(expected), `Expected Task metrics boundary to contain: ${expected}`).toBe(true)
}

/**
 * Asserts a call chain is present without depending on where it wraps.
 *
 * These are source-text assertions, so a formatter moving `.catch()` onto its
 * own line would otherwise read as a missing recovery path.
 */
function expectChain(source: string, ...segments: string[]): void {
	const pattern = new RegExp(segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"))
	expect(pattern.test(source), `Expected Task metrics boundary to chain: ${segments.join(" … ")}`).toBe(true)
}

function expectNotContains(source: string, unexpected: string): void {
	expect(source.includes(unexpected), `Expected Task metrics boundary not to contain: ${unexpected}`).toBe(false)
}

describe("Task API rate metrics boundary", () => {
	it("uses Task-local active, round, and execution facts without mixing RPM bases", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const composition = extractMethod(
			source,
			"this.apiRateMetricsService = new TaskApiRateMetricsService({",
			"this.reinitExistingTaskFromId = reinitExistingTaskFromId",
		)
		const headerSnapshot = extractMethod(
			source,
			"public getApiRateSnapshot(): ApiRateSnapshot {",
			"/** Query persisted Task-local API rate history",
		)

		expectContains(source, 'import { TaskApiRateMetricsRepository } from "./performance/task-api-rate-metrics-repository"')
		expectContains(
			source,
			'import { TaskApiResponseExecutionRepository } from "./performance/api-response-execution-repository"',
		)
		expectContains(source, "private readonly apiRateMetricsService: TaskApiRateMetricsService")
		expectContains(composition, "new TaskApiRateMetricsRepository({ taskId })")
		expectContains(composition, "const apiRequestRoundRepository = new TaskApiRequestRoundRepository({")
		expectContains(composition, "legacySource: historyItem ? uiMessage : undefined")
		expectContains(composition, "const apiResponseExecutionRepository = new TaskApiResponseExecutionRepository({ taskId })")
		expectContains(composition, "roundRepository: apiRequestRoundRepository")
		expectContains(composition, "executionRepository: apiResponseExecutionRepository")
		expectContains(composition, "waitForRoundPersistence: () => this.apiRequestRoundLifecycle.waitForRoundPersistence()")
		expectContains(
			composition,
			"waitForExecutionPersistence: () => this.apiRequestRoundLifecycle.waitForExecutionPersistence()",
		)
		expectContains(source, "return this.taskRateMetricsQueryService.query(query)")
		expectChain(source, "this.apiRequestRoundLifecycle", ".initializeRounds()", ".catch((error) =>")
		expectChain(source, "this.apiRequestRoundLifecycle", ".initializeExecutions()", ".catch((error) =>")
		expectNotContains(source, "private readonly apiRateTracker: ApiRateTracker")
		expectContains(headerSnapshot, "const active = this.apiRateMetricsService.getSnapshot()")
		expectContains(headerSnapshot, "const rounds = this.apiRequestRoundLifecycle.getSnapshot()")
		expectContains(headerSnapshot, "const executions = this.apiRequestRoundLifecycle.getExecutionSnapshot()")
		expectContains(headerSnapshot, "requestsPerMinute: executions.requestsPerMinute")
		expectContains(headerSnapshot, "rpmBasis: executions.rpmBasis")
		expectContains(headerSnapshot, "tokensPerMinute: active.tokensPerMinute")
	})

	/**
	 * A new Task must have metrics ready before it can issue a request, but a
	 * restored one must not: metrics are a secondary projection there, and
	 * awaiting them would hold back the historical surface the user is waiting
	 * to see. The two paths therefore assert opposite things on purpose.
	 */
	it("initializes metrics before a new Task can reach an API request", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const startTask = extractMethod(source, "public async startTask(", "/**\n\t * Load and display historical task messages")

		expect(startTask.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeGreaterThanOrEqual(0)
		expect(startTask.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeLessThan(
			startTask.indexOf("TASK_INITIALIZE_REQUESTED"),
		)
	})

	it("starts metrics without delaying a restored Task's historical surface", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const prepareFromHistory = extractMethod(source, "public async prepareFromHistory(", "const isCurrent =")

		// Started, not awaited, and after the surface is ready to display.
		expectChain(prepareFromHistory, "void this.ensureApiRateMetricsInitialized()", ".catch((error) =>")
		expect(prepareFromHistory).not.toContain("await this.ensureApiRateMetricsInitialized()")
		expect(prepareFromHistory.indexOf("await options?.onReadyToDisplay?.()")).toBeLessThan(
			prepareFromHistory.indexOf("void this.ensureApiRateMetricsInitialized()"),
		)
	})

	it("aggregates Provider usage and commits one final exact request snapshot", async () => {
		const source = await readFile(taskSourcePath, "utf8")

		expectContains(source, "onStreamEstimatedTokens: (tokens) => this.apiRateMetricsService.recordEstimatedTokens(tokens)")
		expectContains(source, "this.apiRateMetricsService.setTaskLoopActive(isTaskRateMetricsLoopActive(state.phase))")
		expectContains(source, "this.apiRateMetricsService.trackProviderStream(")
		expectContains(source, "const usageTracker = new TaskRequestUsageTracker()")
		expectContains(source, "const usage = usageTracker.apply(chunk)")
		expectContains(source, "const usage = usageTracker.apply(apiStreamUsage)")
		expectContains(source, "const finalUsage = usageTracker.getSnapshot()")
		expectContains(source, "thoughtsTokens: finalUsage.thoughtsTokens")
		expect(source.match(/this\.apiRateMetricsService\.recordExactUsage\(\{/g)).toHaveLength(1)
		expectNotContains(source, "thoughtsTokens: chunk.thoughtsTokenCount")
		expectNotContains(source, "thoughtsTokens: apiStreamUsage.thoughtsTokenCount")
		expectNotContains(source, "this.apiRateTracker.recordExactTokens(")
	})

	it("flushes and disposes metrics within the bounded Task termination cleanup", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const terminate = extractMethod(source, "async terminate(", "/** Close idle task terminals")

		expect(terminate).toContain(
			'withTerminateTimeout(this.apiRateMetricsService.dispose(), 5_000, "apiRateMetricsService.dispose")',
		)
		expect(terminate).not.toContain("this.apiRateTracker.dispose()")
	})
})
