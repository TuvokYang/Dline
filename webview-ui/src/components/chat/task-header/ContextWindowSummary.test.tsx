import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createContextWindowIndicatorViewModel } from "./ContextWindowIndicatorViewModel"
import { ContextWindowSummary } from "./ContextWindowSummary"

describe("ContextWindowSummary", () => {
	it("shows authoritative segment sizes from the shared indicator view model", () => {
		const indicatorViewModel = createContextWindowIndicatorViewModel({
			taskId: "task-summary",
			revision: 1,
			epoch: 1,
			phase: "receiving",
			durableContextTokens: 137_000,
			pendingSendTokens: 2_000,
			receivingTokens: 100,
			environmentTokens: 1_000,
			contextWindow: 272_000,
			mode: "act",
			updatedAt: 1,
			lineage: { kind: "baseline" },
		})
		render(
			<ContextWindowSummary
				contextWindow={indicatorViewModel.contextWindow}
				indicatorViewModel={indicatorViewModel}
				percentage={indicatorViewModel.percentage}
				tokenUsed={indicatorViewModel.totalTokens}
			/>,
		)

		expect(screen.getByText("Context Window")).toBeInTheDocument()
		expect(screen.getByText("131.9k")).toBeInTheDocument()
		const metricCells = ["used", "remaining", "total"].map((metric) =>
			document.querySelector<HTMLElement>(`[data-context-summary-metric="${metric}"]`),
		)
		for (const cell of metricCells) expect(cell).toHaveClass("min-w-0", "text-center")
		expect(metricCells[0]?.parentElement).toHaveClass("grid", "grid-cols-3", "gap-2")
		const segmentDetails = screen.getByTestId("context-window-segment-details")
		for (const [kind, value, color] of [
			["durable", "137.0k", "var(--vscode-charts-green, #3fb950)"],
			["sending", "2.0k", "var(--vscode-charts-blue, #58a6ff)"],
			["receiving", "100", "var(--vscode-charts-yellow, #d29922)"],
			["environment", "1.0k", "var(--vscode-charts-purple, #bc8cff)"],
		] as const) {
			const detail = segmentDetails.querySelector<HTMLElement>(`[data-segment-detail="${kind}"]`)
			expect(detail).toHaveTextContent(value)
			expect(detail).toHaveStyle({ backgroundColor: color })
		}
	})
})
