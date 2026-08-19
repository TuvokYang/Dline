import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	API_RATE_METRICS_SCHEMA_VERSION,
	ApiRateMetricsFileIntegrityError,
	type ApiRateSecondRecord,
} from "./api-rate-metrics-types"
import { TaskApiRateMetricsRepository } from "./task-api-rate-metrics-repository"

function secondRecord(second: number, overrides: Partial<ApiRateSecondRecord> = {}): ApiRateSecondRecord {
	return {
		schemaVersion: API_RATE_METRICS_SCHEMA_VERSION,
		kind: "second",
		second,
		revision: 0,
		signals: ["request_start"],
		requestCount: 1,
		estimatedTokens: 120,
		effectiveTokens: 120,
		tokenQuality: "estimated",
		runningActiveSeconds: 1,
		runningRequestCount: 1,
		runningTokenCount: 120,
		requestsPerMinute: 60,
		tokensPerMinute: 7_200,
		...overrides,
	}
}

describe("TaskApiRateMetricsRepository", () => {
	let root: string

	beforeEach(async () => {
		const parent = path.join(process.cwd(), "tmp")
		await fs.mkdir(parent, { recursive: true })
		root = await fs.mkdtemp(path.join(parent, "api-rate-metrics-"))
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it("creates a Task-bound JSONL file and restores the latest running state", async () => {
		const filePath = path.join(root, "api_rate_metrics.jsonl")
		const repository = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath, now: () => 1_000 })
		await repository.initialize()
		await repository.append([
			secondRecord(10),
			secondRecord(11, {
				signals: ["stream_tokens"],
				requestCount: 0,
				estimatedTokens: 180,
				effectiveTokens: 180,
				runningActiveSeconds: 2,
				runningRequestCount: 1,
				runningTokenCount: 300,
				requestsPerMinute: 30,
				tokensPerMinute: 9_000,
			}),
		])
		await repository.waitForWrites()

		const raw = await fs.readFile(filePath, "utf8")
		const lines = raw
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>)
		expect(lines[0]).toMatchObject({ schemaVersion: 1, kind: "meta", taskId: "task-a", createdAt: 1_000 })
		expect(lines.slice(1)).toHaveLength(2)

		const reopened = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath })
		await expect(reopened.initialize()).resolves.toMatchObject({
			activeSeconds: 2,
			requestCount: 1,
			tokenCount: 300,
			lastActiveSecond: 11,
			snapshot: { activeSeconds: 2, requestsPerMinute: 30, tokensPerMinute: 9_000 },
			recentRecords: [expect.objectContaining({ second: 10 }), expect.objectContaining({ second: 11 })],
		})
	})

	it("restores separate task-active and provider-active rate denominators", async () => {
		const filePath = path.join(root, "api_rate_metrics_separate_activity.jsonl")
		const repository = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath, now: () => 1_000 })
		await repository.initialize()
		await repository.append([
			secondRecord(10, {
				signals: ["task_active", "provider_active", "request_start", "stream_tokens"],
			}),
			secondRecord(11, {
				signals: ["task_active"],
				requestCount: 0,
				estimatedTokens: 0,
				effectiveTokens: 0,
				runningActiveSeconds: 2,
				runningProviderActiveSeconds: 1,
				runningRequestCount: 1,
				runningTokenCount: 120,
				requestsPerMinute: 30,
				tokensPerMinute: 7_200,
			}),
		])
		await repository.waitForWrites()

		const reopened = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath })
		await expect(reopened.initialize()).resolves.toMatchObject({
			activeSeconds: 2,
			requestCount: 1,
			tokenCount: 120,
			snapshot: { activeSeconds: 2, requestsPerMinute: 30, tokensPerMinute: 7_200 },
		})
	})

	it("ignores a partial tail and marks a malformed middle line as degraded", async () => {
		const filePath = path.join(root, "api_rate_metrics.jsonl")
		await fs.writeFile(
			filePath,
			[
				JSON.stringify({ schemaVersion: 1, kind: "meta", taskId: "task-a", createdAt: 1_000 }),
				JSON.stringify(secondRecord(10)),
				"{malformed}",
				JSON.stringify(secondRecord(11, { runningActiveSeconds: 2 })),
				'{"schemaVersion":1,"kind":"second"',
			].join("\n"),
			"utf8",
		)

		const repository = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath })
		const recovery = await repository.initialize()
		const read = await repository.readAll()

		expect(recovery).toMatchObject({ activeSeconds: 2, lastActiveSecond: 11, degraded: true })
		expect(read.records).toHaveLength(2)
		expect(read.degraded).toBe(true)
	})

	it("refuses an append that would exceed the hard file limit without changing existing data", async () => {
		const filePath = path.join(root, "api_rate_metrics.jsonl")
		const meta = { schemaVersion: 1, kind: "meta", taskId: "task-a", createdAt: 1_000 }
		const firstRecord = secondRecord(10)
		const initialPayload = `${JSON.stringify(meta)}\n`
		const firstPayload = `${JSON.stringify(firstRecord)}\n`
		await fs.writeFile(filePath, initialPayload, "utf8")
		const repository = new TaskApiRateMetricsRepository({
			taskId: "task-a",
			filePath,
			hardLimitBytes: Buffer.byteLength(initialPayload) + Buffer.byteLength(firstPayload),
		})
		await repository.initialize()
		await repository.append([firstRecord])
		await repository.waitForWrites()
		const beforeRejectedAppend = await fs.readFile(filePath, "utf8")

		await expect(repository.append([secondRecord(11)])).rejects.toThrow(/hard limit/i)
		await expect(repository.waitForWrites()).resolves.toBeUndefined()
		expect(await fs.readFile(filePath, "utf8")).toBe(beforeRejectedAppend)
	})

	it("atomically compacts files only after the configured size threshold", async () => {
		const filePath = path.join(root, "api_rate_metrics.jsonl")
		const repository = new TaskApiRateMetricsRepository({
			taskId: "task-a",
			filePath,
			compactionThresholdBytes: 1,
		})
		await repository.initialize()
		await repository.append([
			secondRecord(10, { requestCount: 1, effectiveTokens: 100 }),
			secondRecord(11, { requestCount: 0, effectiveTokens: 200 }),
		])
		await repository.waitForWrites()

		await expect(repository.compactIfNeeded(10 + 3 * 24 * 60 * 60)).resolves.toBe(true)
		const read = await repository.readAll()
		expect(read.records).toEqual([
			expect.objectContaining({
				kind: "rollup",
				resolution: "minute",
				activeSeconds: 2,
				requestCount: 1,
				tokenCount: 300,
			}),
		])
	})

	it("rejects a metrics file owned by another Task", async () => {
		const filePath = path.join(root, "api_rate_metrics.jsonl")
		await fs.writeFile(
			filePath,
			`${JSON.stringify({ schemaVersion: 1, kind: "meta", taskId: "task-b", createdAt: 1_000 })}\n`,
			"utf8",
		)

		const repository = new TaskApiRateMetricsRepository({ taskId: "task-a", filePath })
		await expect(repository.initialize()).rejects.toThrow(ApiRateMetricsFileIntegrityError)
	})
})
