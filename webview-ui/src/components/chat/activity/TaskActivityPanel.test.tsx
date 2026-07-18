// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskActivityPanel } from "./TaskActivityPanel"

const cancelTaskActivities = vi.fn()

vi.mock("./useTaskActivities", () => ({
	cancelTaskActivities: (...args: unknown[]) => cancelTaskActivities(...args),
	useTaskActivities: () => ({
		activities: [
			{
				activityId: "new-command",
				taskId: "task-1",
				kind: "command",
				executionMode: "background",
				status: "running",
				createdAt: 200,
				updatedAt: 200,
				title: "new command",
			},
			{
				activityId: "old-agent",
				taskId: "task-1",
				kind: "subagent",
				executionMode: "foreground",
				status: "completed",
				createdAt: 100,
				updatedAt: 150,
				title: "old agent",
			},
		],
	}),
}))

describe("TaskActivityPanel", () => {
	beforeEach(() => cancelTaskActivities.mockClear())

	it("defaults to active activities in creation order and exposes exact cancellation", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("new command")).toBeInTheDocument()
		expect(within(items[0]).getByText(/Background Command/)).toBeInTheDocument()

		fireEvent.click(within(items[0]).getByRole("button", { name: "Cancel" }))
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["new-command"])
	})

	it("shows all activities and filters the vertical list by type", () => {
		render(<TaskActivityPanel taskId="task-1" />)
		fireEvent.click(screen.getAllByRole("button", { name: "All" })[0])

		let items = screen.getAllByTestId("activity-item")
		expect(items.map((item) => item.textContent)).toEqual([
			expect.stringContaining("new command"),
			expect.stringContaining("old agent"),
		])

		fireEvent.click(screen.getByRole("button", { name: "Subagents" }))
		items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("old agent")).toBeInTheDocument()
	})
})
