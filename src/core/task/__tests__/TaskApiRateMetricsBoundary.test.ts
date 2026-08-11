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

describe("Task API rate metrics boundary", () => {
	it("uses one Task-local metrics service as the real-time and persistence fact source", async () => {
		const source = await readFile(taskSourcePath, "utf8")

		expect(source).toContain('import { TaskApiRateMetricsRepository } from "./performance/task-api-rate-metrics-repository"')
		expect(source).toContain('import { TaskApiRateMetricsService } from "./performance/task-api-rate-metrics-service"')
		expect(source).toContain("private readonly apiRateMetricsService: TaskApiRateMetricsService")
		expect(source).toContain("new TaskApiRateMetricsRepository({ taskId })")
		expect(source).not.toContain("private readonly apiRateTracker: ApiRateTracker")
		expect(source).toContain("return this.apiRateMetricsService.getSnapshot()")
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

	it("routes request, estimated stream, and structured exact usage events to the same service", async () => {
		const source = await readFile(taskSourcePath, "utf8")

		expect(source).toContain("onStreamEstimatedTokens: (tokens) => this.apiRateMetricsService.recordEstimatedTokens(tokens)")
		expect(source).toContain("this.apiRateMetricsService.recordRequestStarted()")
		expect(source).toContain("this.apiRateMetricsService.recordExactUsage({")
		expect(source).toContain("thoughtsTokens: chunk.thoughtsTokenCount")
		expect(source).toContain("thoughtsTokens: apiStreamUsage.thoughtsTokenCount")
		expect(source).not.toContain("this.apiRateTracker.recordExactTokens(")
	})

	it("flushes and disposes metrics within the bounded Task termination cleanup", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const terminate = extractMethod(source, "async terminate()", "/** Close idle task terminals")

		expect(terminate).toContain(
			'withTerminateTimeout(this.apiRateMetricsService.dispose(), 5_000, "apiRateMetricsService.dispose")',
		)
		expect(terminate).not.toContain("this.apiRateTracker.dispose()")
	})
})
