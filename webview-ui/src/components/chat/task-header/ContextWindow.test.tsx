import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

describe("ContextWindow manual compaction", () => {
	it("hides the compact control when the active interaction cannot accept a reply", () => {
		render(<ContextWindow contextWindow={128_000} lastApiReqTotalTokens={64_000} useAutoCondense={false} />)

		expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
