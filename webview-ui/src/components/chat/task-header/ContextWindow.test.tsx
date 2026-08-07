import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

describe("ContextWindow manual compaction", () => {
	it("keeps the compact control visible but greyed out when replies are disabled", () => {
		render(
			<ContextWindow
				compactTaskDisabled
				contextWindow={128_000}
				lastApiReqTotalTokens={64_000}
				onCompactTask={vi.fn(async () => true)}
				useAutoCondense={false}
			/>,
		)

		const compactButton = screen.getByRole("button")
		expect(compactButton).toBeInTheDocument()
		expect(compactButton).toHaveAttribute("aria-disabled", "true")
		expect(compactButton).toHaveClass("pointer-events-none")

		// A disabled compact control must not open the confirmation dialog.
		fireEvent.click(compactButton)
		expect(screen.queryByText("Compact the current task?")).not.toBeInTheDocument()
	})

	it("dispatches the dedicated compact action after confirmation", async () => {
		const onCompactTask = vi.fn(async () => true)
		render(
			<ContextWindow
				contextWindow={128_000}
				lastApiReqTotalTokens={64_000}
				onCompactTask={onCompactTask}
				useAutoCondense={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button"))
		expect(screen.getByText("Compact the current task?")).toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Yes, compact the task"))

		await waitFor(() => expect(onCompactTask).toHaveBeenCalledOnce())
		await waitFor(() => expect(screen.queryByText("Compact the current task?")).not.toBeInTheDocument())
	})
})
