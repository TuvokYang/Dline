import { type TaskRateMetricPoint, TaskRateTokenQuality } from "@shared/proto/dline/task"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TaskRateMetricsChart } from "./TaskRateMetricsChart"

function point(start: number, overrides: Partial<TaskRateMetricPoint> = {}): TaskRateMetricPoint {
	return {
		bucketStartMs: start,
		bucketEndMs: start + 60_000,
		activeSeconds: 1,
		requestCount: 1,
		tokenCount: 10,
		requestsPerMinute: 60,
		tokensPerMinute: 600,
		tokenQuality: TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT,
		provisional: false,
		...overrides,
	}
}

describe("TaskRateMetricsChart", () => {
	it("renders bars, adaptive y-axis ticks, and grid lines by default", () => {
		render(<TaskRateMetricsChart points={[point(0), point(60_000), point(180_000)]} />)

		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-chart-type", "bar")
		expect(screen.getByTestId("task-rate-selected-metric")).toHaveTextContent("TPM")
		expect(screen.getAllByTestId(/task-rate-bar-/)).toHaveLength(3)
		expect(screen.getAllByTestId("task-rate-grid-line").length).toBeGreaterThan(1)
	})

	it("renders sparse line segments without connecting across an idle gap", () => {
		render(<TaskRateMetricsChart chartType="line" metric="rpm" points={[point(0), point(60_000), point(180_000)]} />)

		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-chart-type", "line")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-metric", "rpm")
		expect(screen.getAllByTestId("task-rate-series-line")).toHaveLength(2)
		expect(screen.getAllByTestId(/task-rate-point-/)).toHaveLength(3)
	})

	it("shows a keyboard-accessible tooltip with selected and supporting metrics", () => {
		render(<TaskRateMetricsChart points={[point(Date.parse("2026-08-10T12:00:00.000Z"), { tokenCount: 120 })]} />)

		fireEvent.focus(screen.getByTestId("task-rate-bar-0"))
		const tooltip = screen.getByRole("tooltip")
		expect(tooltip).toHaveTextContent("Time:")
		expect(tooltip).toHaveTextContent("Selected TPM: 600")
		expect(tooltip).toHaveTextContent("TPM: 600")
		expect(tooltip).toHaveTextContent("RPM: 60")
		expect(tooltip).toHaveTextContent("Tokens: 120")
		expect(tooltip).toHaveTextContent("Active seconds: 1")
		expect(tooltip).toHaveTextContent("Quality: Exact")
	})
})
