// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileServiceClient } from "@/services/grpc-client"
import { TaskActivityPanel } from "./TaskActivityPanel"

const cancelTaskActivities = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFile: vi.fn(async () => ({})),
	},
}))

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
				logPath: "C:\\Temp\\activity.log",
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
	beforeEach(() => {
		cancelTaskActivities.mockClear()
		vi.mocked(FileServiceClient.openFile).mockClear()
	})

	it("defaults to active activities in creation order and exposes exact cancellation", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("new command")).toBeInTheDocument()
		expect(within(items[0]).getByText(/Background Command/)).toBeInTheDocument()

		fireEvent.click(within(items[0]).getByRole("button", { name: "Cancel" }))
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["new-command"])
	})

	it("opens a background command log from the active activity", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const item = screen.getByTestId("activity-item")
		fireEvent.click(within(item).getByRole("button", { name: /new command/i }))
		fireEvent.click(within(item).getByRole("button", { name: "Open log file activity.log" }))

		expect(FileServiceClient.openFile).toHaveBeenCalledWith(expect.objectContaining({ value: "C:\\Temp\\activity.log" }))
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
