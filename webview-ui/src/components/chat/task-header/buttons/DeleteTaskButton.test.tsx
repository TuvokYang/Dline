import { StringArrayRequest } from "@shared/proto/dline/common"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import DeleteTaskButton from "./DeleteTaskButton"

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		deleteTasksWithIds: vi.fn(),
	},
}))

describe("DeleteTaskButton", () => {
	it("opens a flat themed confirmation dialog before deleting", async () => {
		render(<DeleteTaskButton taskId="task-1" taskSize={1024} />)

		fireEvent.click(screen.getByRole("button"))

		expect(screen.getByText("Delete Task")).toBeInTheDocument()
		expect(screen.getByText(/This permanently removes the task history/)).toBeInTheDocument()
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		expect(screen.getByText("Delete")).toBeInTheDocument()
		expect(TaskServiceClient.deleteTasksWithIds).not.toHaveBeenCalled()
	})

	it("deletes only after confirmation", async () => {
		render(<DeleteTaskButton taskId="task-1" taskSize={1024} />)

		fireEvent.click(screen.getByRole("button"))
		fireEvent.click(screen.getByText("Delete"))

		await waitFor(() => {
			expect(TaskServiceClient.deleteTasksWithIds).toHaveBeenCalledWith(StringArrayRequest.create({ value: ["task-1"] }))
		})
	})
})
