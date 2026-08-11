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
	it("renders separate TPM and RPM segments instead of connecting across an idle gap", () => {
		render(<TaskRateMetricsChart points={[point(0), point(60_000), point(180_000)]} />)

		expect(screen.getByRole("img", { name: "API rate history chart" })).toBeInTheDocument()
		expect(screen.getAllByTestId("task-rate-series-tpm")).toHaveLength(2)
		expect(screen.getAllByTestId("task-rate-series-rpm")).toHaveLength(2)
	})

	it("shows a keyboard-accessible point tooltip with time, rates, activity and quality", () => {
		render(<TaskRateMetricsChart points={[point(Date.parse("2026-08-10T12:00:00.000Z"))]} />)

		fireEvent.focus(screen.getByTestId("task-rate-point-0"))
		const tooltip = screen.getByRole("tooltip")
		expect(tooltip).toHaveTextContent("Time:")
		expect(tooltip).toHaveTextContent("TPM: 600")
		expect(tooltip).toHaveTextContent("RPM: 60")
		expect(tooltip).toHaveTextContent("Active seconds: 1")
		expect(tooltip).toHaveTextContent("Quality: Exact")
	})
})
