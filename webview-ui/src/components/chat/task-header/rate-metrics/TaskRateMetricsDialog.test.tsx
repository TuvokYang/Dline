import { TaskRateTokenQuality } from "@shared/proto/dline/task"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskRateMetricsDialog } from "./TaskRateMetricsDialog"

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	useTaskRateMetrics: vi.fn(),
}))

vi.mock("./useTaskRateMetrics", () => ({
	useTaskRateMetrics: mocks.useTaskRateMetrics,
}))

function renderDialog() {
	return render(<TaskRateMetricsDialog onOpenChange={vi.fn()} open={true} taskId="task-1" />)
}

beforeEach(() => {
	mocks.refresh.mockReset()
	mocks.useTaskRateMetrics.mockReset().mockReturnValue({
		data: { points: [], degraded: false, truncated: false },
		loading: false,
		refresh: mocks.refresh,
	})
})

describe("TaskRateMetricsDialog", () => {
	it("defaults to Minute and exposes only the two compact views", () => {
		renderDialog()
		expect(mocks.useTaskRateMetrics).toHaveBeenLastCalledWith({ enabled: true, resolution: "minute", taskId: "task-1" })
		expect(screen.getByRole("tab", { name: "Minute" })).toHaveAttribute("aria-selected", "true")
		expect(screen.queryByRole("tab", { name: "Round" })).not.toBeInTheDocument()
		expect(screen.getByRole("radio", { name: "Token / Cache Hit" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("radio", { name: "TPM / RPM" })).toHaveAttribute("aria-checked", "false")
		expect(screen.queryByRole("radio", { name: "Usage & Cache" })).not.toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: "Total Tokens" })).not.toBeInTheDocument()
		expect(screen.getByRole("radiogroup", { name: "Chart type" })).toBeInTheDocument()
		expect(screen.getByRole("radio", { name: "Line" })).toHaveAttribute("aria-checked", "true")

		fireEvent.click(screen.getByRole("tab", { name: "Hour" }))
		expect(mocks.useTaskRateMetrics).toHaveBeenLastCalledWith({ enabled: true, resolution: "hour", taskId: "task-1" })

		fireEvent.click(screen.getByRole("tab", { name: "Day" }))
		expect(mocks.useTaskRateMetrics).toHaveBeenLastCalledWith({ enabled: true, resolution: "day", taskId: "task-1" })
	})

	it("renders loading, empty and retryable error states", () => {
		mocks.useTaskRateMetrics.mockReturnValue({ loading: true, refresh: mocks.refresh })
		const rendered = renderDialog()
		expect(screen.getByRole("status")).toHaveTextContent("Loading API rate history")

		mocks.useTaskRateMetrics.mockReturnValue({
			data: { points: [], degraded: false, truncated: false },
			loading: false,
			refresh: mocks.refresh,
		})
		rendered.rerender(<TaskRateMetricsDialog onOpenChange={vi.fn()} open={true} taskId="task-1" />)
		expect(screen.getByText("No API activity in this range.")).toBeInTheDocument()

		mocks.useTaskRateMetrics.mockReturnValue({ error: "history unavailable", loading: false, refresh: mocks.refresh })
		rendered.rerender(<TaskRateMetricsDialog onOpenChange={vi.fn()} open={true} taskId="task-1" />)
		expect(screen.getByRole("alert")).toHaveTextContent("history unavailable")
		fireEvent.click(screen.getByRole("button", { name: "Retry" }))
		expect(mocks.refresh).toHaveBeenCalledOnce()
	})

	it("shows degraded, truncation and retention notices alongside the chart", () => {
		mocks.useTaskRateMetrics.mockReturnValue({
			data: {
				points: [
					{
						bucketStartMs: Date.parse("2026-08-10T12:00:00.000Z"),
						bucketEndMs: Date.parse("2026-08-10T12:01:00.000Z"),
						activeSeconds: 2,
						requestCount: 1,
						tokenCount: 200,
						requestsPerMinute: 30,
						tokensPerMinute: 6_000,
						tokenQuality: TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_MIXED,
						provisional: false,
					},
				],
				degraded: true,
				truncated: true,
				retentionStartMs: Date.parse("2026-08-01T00:00:00.000Z"),
			},
			loading: false,
			refresh: mocks.refresh,
		})
		renderDialog()

		expect(screen.getByText("History may be incomplete.")).toBeInTheDocument()
		expect(screen.getByText("Showing the most recent available points.")).toBeInTheDocument()
		expect(screen.getByText(/History retained from/)).toBeInTheDocument()
		expect(screen.getByTestId("task-usage-cache-chart")).toBeInTheDocument()
		expect(screen.getByRole("img", { name: "Task usage and cache hit history chart" })).toBeInTheDocument()
		expect(screen.queryByRole("radiogroup", { name: "Chart type" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("radio", { name: "TPM" }))
		expect(screen.getByRole("radiogroup", { name: "Chart type" })).toBeInTheDocument()
		expect(screen.getByRole("radio", { name: "TPM" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("radio", { name: "Line" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-metric", "tpm")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-chart-type", "line")

		fireEvent.click(screen.getByRole("radio", { name: "Bar" }))
		expect(screen.getByRole("radio", { name: "Bar" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-chart-type", "bar")

		fireEvent.click(screen.getByRole("radio", { name: "RPM" }))
		expect(screen.getByRole("radio", { name: "RPM" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-metric", "rpm")

		fireEvent.click(screen.getByRole("radio", { name: "Total Tokens" }))
		expect(screen.getByRole("radio", { name: "Total Tokens" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-metric", "tokens")

		fireEvent.click(screen.getByRole("radio", { name: "Line" }))
		expect(screen.getByRole("radio", { name: "Line" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("img", { name: "API rate history chart" })).toHaveAttribute("data-chart-type", "line")

		fireEvent.click(screen.getByRole("radio", { name: "Usage & Cache" }))
		expect(screen.queryByRole("radiogroup", { name: "Chart type" })).not.toBeInTheDocument()
		expect(screen.getByTestId("task-usage-cache-chart")).toBeInTheDocument()
	})
})
