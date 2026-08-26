import { type TaskRateMetricPoint, TaskRateRoundStatus, TaskRateRpmBasis, TaskRateUsageQuality } from "@shared/proto/dline/task"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TaskUsageCacheChart } from "./TaskUsageCacheChart"

function point(startMs: number, overrides: Partial<TaskRateMetricPoint> = {}): TaskRateMetricPoint {
	return {
		bucketStartMs: startMs,
		bucketEndMs: startMs + 1,
		provisional: false,
		cacheUsageAvailable: true,
		usageAvailable: true,
		providerDurationMs: 2_000,
		providerRoundCount: 1,
		completedRoundCount: 1,
		failedRoundCount: 0,
		cancelledRoundCount: 0,
		abortedRoundCount: 0,
		rpmBasis: TaskRateRpmBasis.TASK_RATE_RPM_BASIS_PROVIDER_DURATION,
		usageQuality: TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_EXACT,
		status: TaskRateRoundStatus.TASK_RATE_ROUND_STATUS_COMPLETED,
		roundId: `round-${startMs}`,
		logicalRequestId: `request-${startMs}`,
		apiIndex: 7,
		taskAttempt: 2,
		providerAttempt: 1,
		inputTokens: 100,
		outputTokens: 20,
		cacheWriteTokens: 10,
		cacheReadTokens: 0,
		cacheHitRate: 0,
		requestsPerMinute: 30,
		tokensPerMinute: 4_500,
		tokenCount: 130,
		...overrides,
	}
}

describe("TaskUsageCacheChart", () => {
	it("renders the five-series legend and both Token and percentage axes", () => {
		render(<TaskUsageCacheChart points={[point(1_000), point(2_000, { cacheHitRate: 0.5 })]} />)

		const chart = screen.getByRole("img", { name: "Task usage and cache hit history chart" })
		expect(chart).toHaveAttribute("data-left-axis", "tokens")
		expect(chart).toHaveAttribute("data-right-axis", "cache-hit-rate")
		expect(screen.getAllByTestId("task-usage-cache-legend-item").map((item) => item.textContent)).toEqual([
			"Input",
			"Output",
			"Cache Creation",
			"Cache Read",
			"Cache Hit Rate",
		])
		expect(screen.getAllByTestId("task-usage-cache-token-tick").length).toBeGreaterThan(1)
		expect(screen.getAllByTestId("task-usage-cache-percentage-tick").map((item) => item.textContent)).toEqual([
			"0%",
			"20%",
			"40%",
			"60%",
			"80%",
			"100%",
		])
		expect(screen.getByTestId("task-usage-cache-line-cacheHit-0")).toHaveAttribute("stroke-dasharray", "6 4")
	})

	it("renders an explicit zero-percent point while leaving unavailable cache usage absent", () => {
		render(
			<TaskUsageCacheChart
				points={[
					point(1_000, { cacheHitRate: 0 }),
					point(2_000, { cacheHitRate: undefined, cacheUsageAvailable: false }),
				]}
			/>,
		)

		expect(screen.getByTestId("task-usage-cache-point-cacheHit-0")).toHaveAttribute("data-value", "0")
		expect(screen.queryByTestId("task-usage-cache-point-cacheHit-1")).not.toBeInTheDocument()
	})

	it("breaks unavailable usage into separate SVG path segments", () => {
		render(
			<TaskUsageCacheChart
				points={[point(1_000), point(2_000, { inputTokens: undefined, usageAvailable: false }), point(3_000)]}
			/>,
		)

		expect(screen.getAllByTestId(/^task-usage-cache-line-input-/)).toHaveLength(2)
	})

	it("shows one keyboard-accessible tooltip with round identity, status, usage, rates and quality", () => {
		render(<TaskUsageCacheChart points={[point(Date.parse("2026-08-25T12:00:00.000Z"))]} />)

		fireEvent.focus(screen.getByTestId("task-usage-cache-hit-area-0"))
		const tooltip = screen.getByRole("tooltip")
		expect(tooltip).toHaveClass("pointer-events-none", "bottom-2", "grid-cols-2")
		expect(tooltip).toHaveTextContent("Round: round-")
		expect(tooltip).toHaveTextContent("Logical request: request-")
		expect(tooltip).toHaveTextContent("API index: 7")
		expect(tooltip).toHaveTextContent("Task attempt: 2")
		expect(tooltip).toHaveTextContent("Provider attempt: 1")
		expect(tooltip).toHaveTextContent("Status: Completed")
		expect(tooltip).toHaveTextContent("Input: 100")
		expect(tooltip).toHaveTextContent("Cache Hit Rate: 0.0%")
		expect(tooltip).toHaveTextContent("Provider duration: 2,000 ms")
		expect(tooltip).toHaveTextContent("RPM: 30")
		expect(tooltip).toHaveTextContent("TPM: 4,500")
		expect(tooltip).toHaveTextContent("Total Tokens: 130")
		expect(tooltip).toHaveTextContent("Quality: Exact")
		expect(tooltip).toHaveTextContent("Provisional: No")
		expect(tooltip).toHaveTextContent("History: Complete")
	})
})
