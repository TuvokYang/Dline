import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import NewTaskButton from "./NewTaskButton"

describe("NewTaskButton", () => {
	it("exposes the task-closing action and invokes it", () => {
		const onClick = vi.fn()
		render(<NewTaskButton onClick={onClick} />)

		fireEvent.click(screen.getByRole("button", { name: "Close Task" }))

		expect(onClick).toHaveBeenCalledOnce()
	})
})
