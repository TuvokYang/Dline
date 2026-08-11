import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TaskRateMetrics } from "./TaskRateMetrics"

describe("TaskRateMetrics", () => {
	it("renders the green rate capsule as a semantic button with active seconds", () => {
		render(<TaskRateMetrics activeSeconds={7} requestsPerMinute={3} taskId="task-1" tokensPerMinute={4_500} />)

		const button = screen.getByRole("button", { name: /View API rate history/ })
		expect(button).toHaveTextContent("Active:7s")
		expect(button).toHaveTextContent("RPM:3")
		expect(button).toHaveTextContent("TPM:4.5K")
		expect(button).toHaveClass("rounded-full", "bg-success/80", "text-background")
	})

	it("opens history without bubbling click or keyboard activation to the Task header", async () => {
		const parentClick = vi.fn()
		const user = userEvent.setup()
		render(
			<div onClick={parentClick} onKeyDown={parentClick}>
				<TaskRateMetrics activeSeconds={7} requestsPerMinute={3} taskId="task-1" tokensPerMinute={4_500} />
			</div>,
		)

		const button = screen.getByRole("button", { name: /View API rate history/ })
		fireEvent.click(button)
		expect(screen.getByRole("dialog", { name: "API rate history" })).toBeInTheDocument()
		expect(parentClick).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		parentClick.mockClear()
		button.focus()
		await user.keyboard("{Enter}")
		expect(screen.getByRole("dialog", { name: "API rate history" })).toBeInTheDocument()
		expect(parentClick).not.toHaveBeenCalled()
	})
})
