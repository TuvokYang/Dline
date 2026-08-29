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
		expectContains(source, "this.apiRequestRoundLifecycle.initializeRounds().catch((error) =>")
		expectContains(source, "this.apiRequestRoundLifecycle.initializeExecutions().catch((error) =>")
		expectNotContains(source, "private readonly apiRateTracker: ApiRateTracker")
		expectContains(headerSnapshot, "const active = this.apiRateMetricsService.getSnapshot()")
		expectContains(headerSnapshot, "const rounds = this.apiRequestRoundLifecycle.getSnapshot()")
		expectContains(headerSnapshot, "const executions = this.apiRequestRoundLifecycle.getExecutionSnapshot()")
		expectContains(headerSnapshot, "requestsPerMinute: executions.requestsPerMinute")
		expectContains(headerSnapshot, "rpmBasis: executions.rpmBasis")
		expectContains(headerSnapshot, "tokensPerMinute: active.tokensPerMinute")
	})

	it("initializes metrics before new or restored Task work can reach an API request", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const startTask = extractMethod(source, "public async startTask(", "/**\n\t * Load and display historical task messages")
		const displayHistory = extractMethod(source, "public async displayHistory(", "/**\n\t * Reconcile a historical task")

		expect(startTask.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeGreaterThanOrEqual(0)
		expect(startTask.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeLessThan(
			startTask.indexOf("TASK_INITIALIZE_REQUESTED"),
		)
		expect(displayHistory.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeGreaterThanOrEqual(0)
		expect(displayHistory.indexOf("await this.ensureApiRateMetricsInitialized()")).toBeLessThan(
			displayHistory.indexOf("this.taskState.isInitialized = true"),
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
