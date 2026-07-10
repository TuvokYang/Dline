import type { HistoryItem } from "@shared/HistoryItem"
import { StringArrayRequest } from "@shared/proto/dline/common"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import HistoryViewItem from "./HistoryViewItem"

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		deleteTasksWithIds: vi.fn(),
		exportTaskWithId: vi.fn(),
		openTaskInNewWindow: vi.fn(),
		showTaskWithId: vi.fn(),
	},
}))

/**
 * Build a history item fixture for interaction tests.
 * @returns History item fixture.
 */
function buildItem(): HistoryItem {
	return {
		id: "task-1",
		task: "Investigate delete behavior",
		ts: Date.now(),
		size: 1024,
	}
}

describe("HistoryViewItem", () => {
	it("does not open the task when clicking delete", () => {
		const handleDeleteHistoryItem = vi.fn()

		render(
			<HistoryViewItem
				handleDeleteHistoryItem={handleDeleteHistoryItem}
				handleHistorySelect={vi.fn()}
				index={0}
				item={buildItem()}
				pendingFavoriteToggles={{}}
				selectedItems={[]}
				toggleFavorite={vi.fn()}
			/>,
		)

		const deleteButton = screen.getByRole("button", { name: "Delete" })
		fireEvent.pointerDown(deleteButton)
		fireEvent.mouseDown(deleteButton)
		fireEvent.click(deleteButton)

		expect(handleDeleteHistoryItem).toHaveBeenCalledWith("task-1")
		expect(TaskServiceClient.showTaskWithId).not.toHaveBeenCalled()
		expect(TaskServiceClient.deleteTasksWithIds).not.toHaveBeenCalledWith(StringArrayRequest.create({ value: ["task-1"] }))
	})
})
