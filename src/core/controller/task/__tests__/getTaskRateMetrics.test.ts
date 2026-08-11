import type { ApiRateMetricsQuery, ApiRateMetricsQueryResult } from "@core/task/performance/api-rate-metrics-types"
import { GetTaskRateMetricsRequest, TaskRateMetricsResolution, TaskRateTokenQuality } from "@shared/proto/dline/task"
import { describe, expect, it, vi } from "vitest"
import { getTaskRateMetrics } from "../getTaskRateMetrics"

interface RateMetricsTask {
	taskId: string
	queryApiRateMetrics(query: ApiRateMetricsQuery): Promise<ApiRateMetricsQueryResult>
}

function controller(task?: RateMetricsTask): { task?: RateMetricsTask } {
	return task ? { task } : {}
}

function request(overrides: Partial<GetTaskRateMetricsRequest> = {}): GetTaskRateMetricsRequest {
	return GetTaskRateMetricsRequest.create({
		taskId: "task-1",
		resolution: TaskRateMetricsResolution.TASK_RATE_METRICS_RESOLUTION_HOUR,
		startMs: 1_500,
		endMs: 61_001,
		maxPoints: 24,
		...overrides,
	})
}

describe("getTaskRateMetrics", () => {
	it("maps the public query to the active Task and preserves history metadata", async () => {
		const queryApiRateMetrics = vi.fn(
			async (): Promise<ApiRateMetricsQueryResult> => ({
				points: [
					{
						bucketStartMs: 3_600_000,
						bucketEndMs: 7_200_000,
						activeSeconds: 12,
						requestCount: 3,
						tokenCount: 9_000,
						requestsPerMinute: 15,
						tokensPerMinute: 45_000,
						tokenQuality: "exact",
						provisional: true,
					},
				],
				degraded: true,
				truncated: true,
				retentionStartMs: 3_600_000,
			}),
		)

		const response = await getTaskRateMetrics(controller({ taskId: "task-1", queryApiRateMetrics }) as never, request())

		expect(queryApiRateMetrics).toHaveBeenCalledOnce()
		expect(queryApiRateMetrics).toHaveBeenCalledWith({
			resolution: "hour",
			startSecond: 1,
			endSecond: 62,
			maxPoints: 24,
		})
		expect(response).toMatchObject({
			degraded: true,
			truncated: true,
			retentionStartMs: 3_600_000,
			points: [
				{
					bucketStartMs: 3_600_000,
					bucketEndMs: 7_200_000,
					activeSeconds: 12,
					requestCount: 3,
					tokenCount: 9_000,
					requestsPerMinute: 15,
					tokensPerMinute: 45_000,
					tokenQuality: TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT,
					provisional: true,
				},
			],
		})
	})

	it("rejects a query when no Task is active", async () => {
		await expect(getTaskRateMetrics(controller() as never, request())).rejects.toThrow("active Task")
	})

	it("rejects a query for a different Task without reading its metrics", async () => {
		const queryApiRateMetrics = vi.fn(
			async (): Promise<ApiRateMetricsQueryResult> => ({
				points: [],
				degraded: false,
				truncated: false,
			}),
		)

		await expect(
			getTaskRateMetrics(controller({ taskId: "task-1", queryApiRateMetrics }) as never, request({ taskId: "task-2" })),
		).rejects.toThrow("active Task")
		expect(queryApiRateMetrics).not.toHaveBeenCalled()
	})

	it("rejects an unspecified resolution before querying persistence", async () => {
		const queryApiRateMetrics = vi.fn(
			async (): Promise<ApiRateMetricsQueryResult> => ({
				points: [],
				degraded: false,
				truncated: false,
			}),
		)

		await expect(
			getTaskRateMetrics(
				controller({ taskId: "task-1", queryApiRateMetrics }) as never,
				request({ resolution: TaskRateMetricsResolution.TASK_RATE_METRICS_RESOLUTION_UNSPECIFIED }),
			),
		).rejects.toThrow("resolution")
		expect(queryApiRateMetrics).not.toHaveBeenCalled()
	})

	it("rejects an empty time range before querying persistence", async () => {
		const queryApiRateMetrics = vi.fn(
			async (): Promise<ApiRateMetricsQueryResult> => ({
				points: [],
				degraded: false,
				truncated: false,
			}),
		)

		await expect(
			getTaskRateMetrics(
				controller({ taskId: "task-1", queryApiRateMetrics }) as never,
				request({ startMs: 10_000, endMs: 10_000 }),
			),
		).rejects.toThrow("time range")
		expect(queryApiRateMetrics).not.toHaveBeenCalled()
	})
})
