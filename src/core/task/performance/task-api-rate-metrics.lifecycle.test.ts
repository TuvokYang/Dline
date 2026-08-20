import { afterEach, describe, expect, it, vi } from "vitest"
import type {
	ApiRateMetricsDataRecord,
	ApiRateMetricsReadResult,
	ApiRateMetricsRecovery,
	ApiRateMetricsRepository,
} from "./api-rate-metrics-types"
import { TaskApiRateMetricsService } from "./task-api-rate-metrics-service"

class MemoryRepository implements ApiRateMetricsRepository {
	readonly records: ApiRateMetricsDataRecord[] = []

	async initialize(): Promise<ApiRateMetricsRecovery> {
		return { activeSeconds: 0, requestCount: 0, tokenCount: 0, snapshot: {}, degraded: false }
	}

	async append(records: readonly ApiRateMetricsDataRecord[]): Promise<void> {
		this.records.push(...records)
	}

	async readAll(): Promise<ApiRateMetricsReadResult> {
		return { records: [...this.records], degraded: false, fileBytes: 0, lineCount: this.records.length }
	}

	async replaceAll(records: readonly ApiRateMetricsDataRecord[]): Promise<void> {
		this.records.splice(0, this.records.length, ...records)
	}

	async compactIfNeeded(): Promise<boolean> {
		return false
	}

	async waitForWrites(): Promise<void> {}

	async getFilePath(): Promise<string> {
		return "memory://task-api-rate-metrics-lifecycle"
	}
}

afterEach(() => {
	vi.useRealTimers()
})

describe("TaskApiRateMetricsService rate semantics", () => {
	it("does not count Provider activity as RPM when the Task runtime is inactive", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-08-20T10:00:00.000Z"))
		const service = new TaskApiRateMetricsService({ repository: new MemoryRepository() })
		await service.initialize()

		service.recordRequestStarted()
		service.recordEstimatedTokens(120)
		service.recordProviderRequestFinished()

		expect(service.getSnapshot()).toEqual({
			activeSeconds: 0,
			requestsPerMinute: 0,
			tokensPerMinute: 7_200,
		})
	})

	it("uses Task runtime seconds for RPM and sending/receiving seconds for TPM", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-08-20T10:00:00.000Z"))
		const service = new TaskApiRateMetricsService({ repository: new MemoryRepository() })
		await service.initialize()

		service.setTaskLoopActive(true)
		await vi.advanceTimersByTimeAsync(5_000)
		service.recordRequestStarted()
		service.recordEstimatedTokens(120)
		service.recordProviderRequestFinished()
		service.setTaskLoopActive(false)

		const snapshot = service.getSnapshot()
		expect(snapshot.activeSeconds).toBe(6)
		expect(snapshot.requestsPerMinute).toBe(10)
		expect(snapshot.tokensPerMinute).toBe(7_200)
	})
})
