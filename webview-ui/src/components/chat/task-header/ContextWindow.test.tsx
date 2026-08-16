import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

describe("ContextWindow metrics", () => {
	it("renders context usage without owning the compact action", () => {
		render(<ContextWindow contextWindow={128_000} lastApiReqTotalTokens={64_000} useAutoCondense={false} />)

		expect(screen.getByRole("progressbar", { name: "Context window usage progress" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Compact task" })).not.toBeInTheDocument()
	})

	it("keeps the compact action disabled in the context row when compaction cannot re-enter", () => {
		const onCompactTask = vi.fn(async () => true)
		render(
			<ContextWindow
				compactTaskDisabled
				contextWindow={128_000}
				lastApiReqTotalTokens={64_000}
				onCompactTask={onCompactTask}
				useAutoCondense={false}
			/>,
		)

		const compactButton = screen.getByRole("button", { name: "Compact task" })
		expect(compactButton).toHaveAttribute("aria-disabled", "true")
		fireEvent.click(compactButton)
		expect(screen.queryByText("Compact the current task?")).not.toBeInTheDocument()
		expect(onCompactTask).not.toHaveBeenCalled()
	})

	it("dispatches the compact action from the context row after confirmation", async () => {
		const onCompactTask = vi.fn(async () => true)
		render(
			<ContextWindow
				contextWindow={128_000}
				lastApiReqTotalTokens={64_000}
				onCompactTask={onCompactTask}
				useAutoCondense={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Compact task" }))
		expect(screen.getByText("Compact the current task?")).toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Yes, compact the task"))

		await waitFor(() => expect(onCompactTask).toHaveBeenCalledOnce())
		await waitFor(() => expect(screen.queryByText("Compact the current task?")).not.toBeInTheDocument())
	})

	it("renders the authoritative four segments in durable, sending, receiving, ENV order", () => {
		render(
			<ContextWindow
				contextWindowIndicator={{
					taskId: "task-1",
					revision: 2,
					epoch: 1,
					phase: "receiving",
					durableContextTokens: 40_000,
					pendingSendTokens: 2_000,
					receivingTokens: 3_000,
					environmentTokens: 1_000,
					contextWindow: 100_000,
					mode: "act",
					updatedAt: 1,
					lineage: { kind: "baseline" },
				}}
				useAutoCondense={false}
			/>,
		)

		const progress = screen.getByTestId("context-window-segmented-progress")
		expect(progress).toHaveAttribute("title", "Context phase: receiving")
		expect(screen.getByTestId("context-window-segment-durable")).toHaveAttribute("aria-label", "Durable: 40000 tokens")
		expect(screen.getByTestId("context-window-segment-sending")).toHaveAttribute("aria-label", "Sending: 2000 tokens")
		expect(screen.getByTestId("context-window-segment-receiving")).toHaveAttribute("aria-label", "Receiving: 3000 tokens")
		expect(screen.getByTestId("context-window-segment-environment")).toHaveAttribute("aria-label", "ENV: 1000 tokens")
	})

	it("renders nothing when context-window metrics are unavailable", () => {
		const { container } = render(<ContextWindow useAutoCondense={false} />)

		expect(container).toBeEmptyDOMElement()
	})
})
