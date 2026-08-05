import type { HistoryItem } from "@shared/HistoryItem"
import { StringArrayRequest } from "@shared/proto/dline/common"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import HistoryPreview, { filterHistoryPreview, formatHistoryTimestamp, HISTORY_PREVIEW_LIMIT } from "./HistoryPreview"
import HistoryViewItem from "./HistoryViewItem"

const extensionState = vi.hoisted(() => ({
	taskHistory: [] as HistoryItem[],
	workspaceRoots: [{ path: "C:\\work\\current", name: "current" }],
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		deleteTasksWithIds: vi.fn(),
		exportTaskWithId: vi.fn(),
		getTaskHistory: vi.fn(),
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

function historyItem(id: string, ts: number, overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id,
		task: `Task ${id}`,
		ts,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		cwdOnTaskInitialization: "C:\\work\\current",
		...overrides,
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

describe("HistoryPreview", () => {
	beforeEach(() => {
		extensionState.taskHistory = []
		extensionState.workspaceRoots = [{ path: "C:\\work\\current", name: "current" }]
		vi.mocked(TaskServiceClient.getTaskHistory).mockReset().mockResolvedValue({ tasks: [], totalCount: 0 })
	})

	it("defaults to the current workspace and requests newest tasks", async () => {
		extensionState.taskHistory = [
			historyItem("workspace", new Date(2026, 0, 1, 2, 3, 4).getTime()),
			historyItem("other", new Date(2026, 0, 2).getTime(), { cwdOnTaskInitialization: "C:\\work\\other" }),
		]

		render(<HistoryPreview showHistoryView={vi.fn()} />)

		expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByText("Task workspace")).toBeInTheDocument()
		expect(screen.queryByText("Task other")).not.toBeInTheDocument()
		expect(screen.getByText("2026/01/01 02:03:04")).toBeInTheDocument()
		await waitFor(() =>
			expect(TaskServiceClient.getTaskHistory).toHaveBeenCalledWith(
				expect.objectContaining({ currentWorkspaceOnly: true, favoritesOnly: false, sortBy: "newest" }),
			),
		)
	})

	it("switches between favorite and all task requests", async () => {
		render(<HistoryPreview showHistoryView={vi.fn()} />)
		await waitFor(() => expect(TaskServiceClient.getTaskHistory).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole("button", { name: "Favorite" }))
		await waitFor(() =>
			expect(TaskServiceClient.getTaskHistory).toHaveBeenLastCalledWith(
				expect.objectContaining({ currentWorkspaceOnly: false, favoritesOnly: true }),
			),
		)

		fireEvent.click(screen.getByRole("button", { name: "All" }))
		await waitFor(() =>
			expect(TaskServiceClient.getTaskHistory).toHaveBeenLastCalledWith(
				expect.objectContaining({ currentWorkspaceOnly: false, favoritesOnly: false }),
			),
		)
	})

	it("does not restart the initial workspace request for equivalent state snapshots", async () => {
		extensionState.taskHistory = [historyItem("other", 1, { cwdOnTaskInitialization: "C:\\work\\other" })]
		const { rerender } = render(<HistoryPreview showHistoryView={vi.fn()} />)
		await waitFor(() => expect(TaskServiceClient.getTaskHistory).toHaveBeenCalledTimes(1))

		extensionState.taskHistory = [...extensionState.taskHistory]
		extensionState.workspaceRoots = extensionState.workspaceRoots.map((root) => ({ ...root }))
		rerender(<HistoryPreview showHistoryView={vi.fn()} />)

		await waitFor(() => expect(TaskServiceClient.getTaskHistory).toHaveBeenCalledTimes(1))
	})

	it("retries a transient initial workspace request failure", async () => {
		vi.mocked(TaskServiceClient.getTaskHistory)
			.mockRejectedValueOnce(new Error("bridge not ready"))
			.mockResolvedValueOnce({ tasks: [historyItem("workspace", 1)], totalCount: 1 })

		render(<HistoryPreview showHistoryView={vi.fn()} />)

		await waitFor(() => expect(TaskServiceClient.getTaskHistory).toHaveBeenCalledTimes(2))
		expect(await screen.findByText("Task workspace")).toBeInTheDocument()
	})

	it("shows up to ten newest tasks for the selected workspace", () => {
		const tasks = Array.from({ length: 12 }, (_, index) => historyItem(String(index), index + 1))
		tasks.push(historyItem("other", 100, { cwdOnTaskInitialization: "C:\\work\\other" }))

		const result = filterHistoryPreview(tasks, "workspace", ["c:/work/current/"])

		expect(result).toHaveLength(HISTORY_PREVIEW_LIMIT)
		expect(result.map((item) => item.id)).toEqual(["11", "10", "9", "8", "7", "6", "5", "4", "3", "2"])
	})

	it("keeps favorites independent of workspace", () => {
		const result = filterHistoryPreview(
			[
				historyItem("current", 1, { isFavorited: false }),
				historyItem("favorite", 2, { cwdOnTaskInitialization: "C:\\work\\other", isFavorited: true }),
			],
			"favorite",
			["C:\\work\\current"],
		)

		expect(result.map((item) => item.id)).toEqual(["favorite"])
	})

	it("formats the last-edit timestamp with seconds", () => {
		expect(formatHistoryTimestamp(new Date(2026, 0, 1, 2, 3, 4).getTime())).toBe("2026/01/01 02:03:04")
	})
})
