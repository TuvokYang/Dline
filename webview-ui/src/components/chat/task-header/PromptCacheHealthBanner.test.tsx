import type { PromptCacheHealthSnapshot } from "@shared/PromptCacheHealth"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PromptCacheHealthBanner } from "./PromptCacheHealthBanner"

function snapshot(overrides: Partial<PromptCacheHealthSnapshot> = {}): PromptCacheHealthSnapshot {
	return {
		status: "waiting",
		sampleCount: 0,
		warmingRound: 0,
		warmingTarget: 3,
		nearContextWindow: false,
		...overrides,
	}
}

describe("PromptCacheHealthBanner", () => {
	it.each(["disabled", "waiting", "healthy"] as const)("does not render for %s state", (status) => {
		const { container } = render(<PromptCacheHealthBanner health={snapshot({ status })} />)

		expect(container).toBeEmptyDOMElement()
	})

	it("renders progressive warming status", () => {
		render(<PromptCacheHealthBanner health={snapshot({ status: "warming", warmingRound: 2, sampleCount: 2 })} />)

		expect(screen.getByRole("status")).toHaveTextContent("Prompt cache warming (2/3)")
		expect(screen.getByText("Dline is checking whether cached input grows across requests.")).toBeInTheDocument()
	})

	it("renders a non-dismissible stalled cache warning", () => {
		render(
			<PromptCacheHealthBanner
				health={snapshot({
					status: "warning",
					warningReason: "cache_not_improving",
					hitRate: 10,
					cacheReadTokens: 1_000,
					promptTokens: 10_000,
				})}
			/>,
		)

		expect(screen.getByRole("alert")).toHaveTextContent("Prompt cache is not improving")
		expect(screen.getByRole("alert")).toHaveTextContent("three eligible requests")
		expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument()
	})

	it("renders a distinct near-context warning", () => {
		render(
			<PromptCacheHealthBanner
				health={snapshot({
					status: "warning",
					warningReason: "near_context_low_hit_rate",
					hitRate: 82.5,
					nearContextWindow: true,
				})}
			/>,
		)

		expect(screen.getByRole("alert")).toHaveTextContent("Prompt cache is low near the context limit")
		expect(screen.getByRole("alert")).toHaveTextContent("Expected at least 90%")
		expect(screen.getByRole("alert")).toHaveTextContent("82.5%")
	})
})
