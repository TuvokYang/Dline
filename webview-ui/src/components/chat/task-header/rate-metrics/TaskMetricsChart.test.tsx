import { type TaskRateMetricPoint, TaskRateRpmBasis, TaskRateUsageQuality } from "@shared/proto/dline/task"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { createSmoothPath, TaskMetricsChart } from "./TaskMetricsChart"
import type { TaskMetricsChartPoint } from "./TaskMetricsChartModel"

function point(startMs: number, overrides: Partial<TaskRateMetricPoint> = {}): TaskRateMetricPoint {
	return {
		bucketStartMs: startMs,
		bucketEndMs: startMs + 60_000,
		provisional: false,
		cacheUsageAvailable: true,
		usageAvailable: true,
		providerRoundCount: 1,
		completedRoundCount: 1,
		failedRoundCount: 0,
		cancelledRoundCount: 0,
		abortedRoundCount: 0,
		executionCount: 1,
		completedExecutionCount: 1,
		failedExecutionCount: 0,
		cancelledExecutionCount: 0,
		abortedExecutionCount: 0,
		rpmBasis: TaskRateRpmBasis.TASK_RATE_RPM_BASIS_EXECUTION_DURATION,
		usageQuality: TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_EXACT,
		inputTokens: 100,
		outputTokens: 20,
		cacheWriteTokens: 10,
		cacheReadTokens: 5,
		cacheHitRate: 5 / 115,
		tokensPerMinute: 4_500,
		requestsPerMinute: 30,
		...overrides,
	}
}

describe("TaskMetricsChart", () => {
	it("renders accessible toggle legends and keeps Total Tokens disabled by default", async () => {
		const user = userEvent.setup()
		render(<TaskMetricsChart chartType="line" points={[point(0), point(60_000)]} view="tokenCache" />)

		const expected = ["Input", "Output", "Cache Write", "Cache Read", "Cache Hit Rate", "Total Tokens"]
		const legend = within(screen.getByRole("group", { name: "Chart series" }))
		expect(legend.getAllByRole("button").map((button) => button.textContent)).toEqual(expected)
		for (const label of expected.slice(0, -1))
			expect(legend.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true")
		const total = legend.getByRole("button", { name: "Total Tokens" })
		expect(total).toHaveAttribute("aria-pressed", "false")
		expect(screen.queryByTestId("task-metrics-line-totalTokens-0")).not.toBeInTheDocument()

		await user.click(total)
		expect(total).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByTestId("task-metrics-line-totalTokens-0")).toBeInTheDocument()

		const input = legend.getByRole("button", { name: "Input" })
		input.focus()
		await user.keyboard("{Enter}")
		expect(input).toHaveAttribute("aria-pressed", "false")
		expect(screen.queryByTestId("task-metrics-line-input-0")).not.toBeInTheDocument()
	})

	it("omits an all-zero series without removing explicit zeros from an active series", () => {
		render(
			<TaskMetricsChart
				chartType="line"
				points={[
					point(0, { cacheWriteTokens: 0, cacheReadTokens: 0 }),
					point(60_000, { cacheWriteTokens: 0, cacheReadTokens: 5 }),
				]}
				view="tokenCache"
			/>,
		)
		const legend = within(screen.getByRole("group", { name: "Chart series" }))
		expect(legend.queryByRole("button", { name: "Cache Write" })).not.toBeInTheDocument()
		expect(legend.getByRole("button", { name: "Cache Read" })).toBeInTheDocument()
		expect(screen.getByTestId("task-metrics-point-cacheRead-0")).toHaveAttribute("data-value", "0")
	})

	it("renders independently toggleable TPM and execution-duration RPM legends", async () => {
		const user = userEvent.setup()
		const rendered = render(<TaskMetricsChart chartType="line" points={[point(0)]} view="rates" />)
		const legend = within(screen.getByRole("group", { name: "Chart series" }))
		const tpm = legend.getByRole("button", { name: "TPM" })
		const rpm = legend.getByRole("button", { name: "RPM" })
		expect(tpm).toHaveAttribute("aria-pressed", "true")
		expect(rpm).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByTestId("task-metrics-line-tpm-0")).toBeInTheDocument()
		expect(screen.getByTestId("task-metrics-line-rpm-0")).toBeInTheDocument()

		await user.click(rpm)
		expect(rpm).toHaveAttribute("aria-pressed", "false")
		expect(screen.queryByTestId("task-metrics-line-rpm-0")).not.toBeInTheDocument()

		rendered.rerender(
			<TaskMetricsChart
				chartType="line"
				points={[point(0, { rpmBasis: TaskRateRpmBasis.TASK_RATE_RPM_BASIS_PROVIDER_DURATION })]}
				view="rates"
			/>,
		)
		expect(screen.queryByTestId("task-metrics-line-rpm-0")).not.toBeInTheDocument()
		expect(screen.getByTestId("task-metrics-line-tpm-0")).toBeInTheDocument()
	})

	it("renders one continuous monotone line with unavailable values at zero and supports Bar locally", () => {
		const points = [
			point(0, { inputTokens: 10 }),
			point(60_000, { inputTokens: undefined, usageAvailable: false }),
			point(120_000, { inputTokens: 20 }),
			point(180_000, { inputTokens: 15 }),
		]
		const rendered = render(<TaskMetricsChart chartType="line" points={points} view="tokenCache" />)
		const paths = screen.getAllByTestId(/^task-metrics-line-input-/)
		expect(paths).toHaveLength(1)
		expect(paths[0]?.getAttribute("d")).not.toMatch(/NaN|Infinity/)
		expect(screen.getByTestId("task-metrics-point-input-1")).toHaveAttribute("data-value", "0")

		rendered.rerender(<TaskMetricsChart chartType="bar" points={points} view="tokenCache" />)
		expect(screen.getByRole("img", { name: "Task metrics history chart" })).toHaveAttribute("data-chart-type", "bar")
		expect(screen.getAllByTestId(/^task-metrics-bar-input-/)).toHaveLength(4)
	})

	it("shows a contained keyboard tooltip without internal Round or Request identity", () => {
		render(<TaskMetricsChart chartType="line" degraded={true} points={[point(0)]} view="tokenCache" />)
		const hitArea = screen.getByTestId("task-metrics-hit-area-0")
		expect(hitArea).toHaveAttribute("pointer-events", "all")
		fireEvent.focus(hitArea)
		const tooltip = screen.getByRole("tooltip")
		expect(tooltip).toHaveClass("inset-x-2", "bottom-2", "max-h-[45%]", "overflow-auto")
		expect(tooltip).toHaveTextContent("Cache Write: 10")
		expect(tooltip).toHaveTextContent("Cache Hit Rate: 4.3%")
		expect(tooltip).toHaveTextContent("History: Degraded")
		expect(tooltip).not.toHaveTextContent(/Round|Request|API index|Provider attempt/i)
	})

	it("produces a finite monotone cubic path for three or more points", () => {
		const segment = [
			{ x: 0, y: 10 },
			{ x: 20, y: 5 },
			{ x: 40, y: 8 },
		].map((coordinates, index) => ({
			...coordinates,
			point: point(index * 60_000),
			value: index,
			barX: 0,
			barWidth: 1,
			barY: 0,
			barHeight: 1,
		})) satisfies TaskMetricsChartPoint[]
		const path = createSmoothPath(segment)
		expect(path).toContain("C")
		expect(path).not.toMatch(/NaN|Infinity/)
	})
})
