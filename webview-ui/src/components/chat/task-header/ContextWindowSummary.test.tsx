import { fireEvent, render, screen } from "@testing-library/react"
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

		fireEvent.click(screen.getByText("Context Window"))

		expect(screen.getByText("131.9k")).toBeInTheDocument()
		for (const [kind, value] of [
			["durable", "137.0k"],
			["sending", "2.0k"],
			["receiving", "100"],
			["environment", "1.0k"],
		] as const) {
			expect(document.querySelector(`[data-segment-detail="${kind}"]`)).toHaveTextContent(value)
		}
	})
})
