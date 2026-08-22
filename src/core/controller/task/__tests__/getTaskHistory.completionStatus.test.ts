import type { Controller } from "@core/controller"
import { getTaskHistory } from "@core/controller/task/getTaskHistory"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { GetTaskHistoryRequest } from "@shared/proto/dline/task"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getSavedClineMessages: vi.fn<(taskId: string) => Promise<ClineMessage[]>>(),
}))

vi.mock("@core/storage/disk", () => ({
	getSavedClineMessages: mocks.getSavedClineMessages,
}))

function historyItem(id: string, ts: number, isCompleted?: boolean): HistoryItem {
	return {
		id,
		task: `Task ${id}`,
		ts,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		isCompleted,
	}
}

describe("getTaskHistory completion status", () => {
	beforeEach(() => {
		mocks.getSavedClineMessages.mockReset()
	})

	it("limits Recent results and backfills completion only for returned legacy items", async () => {
		const history = [historyItem("newest", 3), historyItem("older", 2), historyItem("oldest", 1)]
		const updateTaskHistory = vi.fn(async () => history)
		const controller = {
			stateManager: {
				getGlobalStateKey: vi.fn(() => history),
			},
			updateTaskHistory,
		} as unknown as Controller
		mocks.getSavedClineMessages.mockResolvedValue([
			{ ts: 1, type: "say", say: "task", text: "Task newest" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "Done" },
		])

		const response = await getTaskHistory(
			controller,
			GetTaskHistoryRequest.create({
				includeCompletionStatus: true,
				resultLimit: 1,
				sortBy: "newest",
			}),
		)

		expect(response.totalCount).toBe(3)
		expect(response.tasks).toHaveLength(1)
		expect(response.tasks[0]).toMatchObject({ id: "newest", isCompleted: true })
		expect(mocks.getSavedClineMessages).toHaveBeenCalledOnce()
		expect(mocks.getSavedClineMessages).toHaveBeenCalledWith("newest")
		expect(updateTaskHistory).toHaveBeenCalledWith(expect.objectContaining({ id: "newest", isCompleted: true }))
	})
})
