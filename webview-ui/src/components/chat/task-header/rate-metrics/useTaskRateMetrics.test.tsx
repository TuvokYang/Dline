import { type GetTaskRateMetricsResponse, TaskRateMetricsResolution as ProtoResolution } from "@shared/proto/dline/task"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type TaskRateMetricsResolution, useTaskRateMetrics } from "./useTaskRateMetrics"

const mocks = vi.hoisted(() => ({
	getTaskRateMetrics: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		getTaskRateMetrics: mocks.getTaskRateMetrics,
	},
}))

const NOW_MS = Date.parse("2026-08-10T12:00:00.000Z")

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, reject, resolve }
}

function response(activeSeconds: number): GetTaskRateMetricsResponse {
	return {
		points: [
			{
				bucketStartMs: NOW_MS - 60_000,
				bucketEndMs: NOW_MS,
				activeSeconds,
				requestCount: 1,
				tokenCount: 100,
				requestsPerMinute: 60,
				tokensPerMinute: 6_000,
				tokenQuality: 2,
				provisional: false,
			},
		],
		degraded: false,
		truncated: false,
	}
}

beforeEach(() => {
	mocks.getTaskRateMetrics.mockReset()
	vi.spyOn(Date, "now").mockReturnValue(NOW_MS)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("useTaskRateMetrics", () => {
	it("does not query while the history dialog is closed", () => {
		renderHook(() => useTaskRateMetrics({ enabled: false, resolution: "minute", taskId: "task-1" }))
		expect(mocks.getTaskRateMetrics).not.toHaveBeenCalled()
	})

	it("queries the default Round view as the most recent 60 canonical rounds", async () => {
		mocks.getTaskRateMetrics.mockResolvedValueOnce(response(4))
		const { result } = renderHook(() => useTaskRateMetrics({ enabled: true, resolution: "round", taskId: "task-1" }))

		await waitFor(() => expect(result.current.data?.points[0]?.activeSeconds).toBe(4))
		expect(mocks.getTaskRateMetrics).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_ROUND,
				startMs: 0,
				endMs: NOW_MS,
				maxPoints: 60,
			}),
		)
	})

	it("queries the minute window as the last 60 minutes", async () => {
		mocks.getTaskRateMetrics.mockResolvedValueOnce(response(4))
		const { result } = renderHook(() => useTaskRateMetrics({ enabled: true, resolution: "minute", taskId: "task-1" }))

		expect(result.current.loading).toBe(true)
		await waitFor(() => expect(result.current.data?.points[0]?.activeSeconds).toBe(4))
		expect(mocks.getTaskRateMetrics).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_MINUTE,
				startMs: NOW_MS - 60 * 60 * 1_000,
				endMs: NOW_MS,
				maxPoints: 60,
			}),
		)
	})

	it("does not query again when a parent rerenders for local view or chart state", async () => {
		mocks.getTaskRateMetrics.mockResolvedValueOnce(response(4))
		const { rerender } = renderHook(
			({ localSelection }: { localSelection: string }) => {
				void localSelection
				return useTaskRateMetrics({ enabled: true, resolution: "round", taskId: "task-1" })
			},
			{ initialProps: { localSelection: "usage-cache-line" } },
		)
		await waitFor(() => expect(mocks.getTaskRateMetrics).toHaveBeenCalledTimes(1))

		rerender({ localSelection: "rpm-bar" })
		rerender({ localSelection: "tokens-line" })
		expect(mocks.getTaskRateMetrics).toHaveBeenCalledTimes(1)
	})

	it("discards a stale response after the resolution changes", async () => {
		const staleMinute = deferred<GetTaskRateMetricsResponse>()
		mocks.getTaskRateMetrics.mockReturnValueOnce(staleMinute.promise).mockResolvedValueOnce(response(24))
		const { result, rerender } = renderHook(
			({ resolution }: { resolution: TaskRateMetricsResolution }) =>
				useTaskRateMetrics({ enabled: true, resolution, taskId: "task-1" }),
			{ initialProps: { resolution: "minute" as TaskRateMetricsResolution } },
		)
		await waitFor(() => expect(mocks.getTaskRateMetrics).toHaveBeenCalledTimes(1))

		rerender({ resolution: "hour" })
		await waitFor(() => expect(result.current.data?.points[0]?.activeSeconds).toBe(24))

		await act(async () => staleMinute.resolve(response(1)))
		expect(result.current.data?.points[0]?.activeSeconds).toBe(24)
		expect(mocks.getTaskRateMetrics).toHaveBeenLastCalledWith(
			expect.objectContaining({
				resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_HOUR,
				startMs: NOW_MS - 24 * 60 * 60 * 1_000,
				maxPoints: 24,
			}),
		)
	})

	it("surfaces an RPC error and retries on demand", async () => {
		mocks.getTaskRateMetrics.mockRejectedValueOnce(new Error("history unavailable")).mockResolvedValueOnce(response(2))
		const { result } = renderHook(() => useTaskRateMetrics({ enabled: true, resolution: "day", taskId: "task-1" }))

		await waitFor(() => expect(result.current.error).toBe("history unavailable"))
		act(() => result.current.refresh())
		await waitFor(() => expect(result.current.data?.points[0]?.activeSeconds).toBe(2))
		expect(mocks.getTaskRateMetrics).toHaveBeenCalledTimes(2)
		expect(mocks.getTaskRateMetrics).toHaveBeenLastCalledWith(
			expect.objectContaining({
				resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_DAY,
				startMs: NOW_MS - 30 * 24 * 60 * 60 * 1_000,
				maxPoints: 30,
			}),
		)
	})
})
