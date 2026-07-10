import { Task } from "@core/task"
import { describe, expect, it, vi } from "vitest"

/** Verify task-local mode access and atomic commit ordering without constructing runtime services. */
describe("Task task-local mode", () => {
	/** Keep mode reads isolated to each task state manager. */
	it("reads independent task-local modes", () => {
		const planTask = { taskSm: { mode: "plan" } }
		const actTask = { taskSm: { mode: "act" } }

		expect(Task.prototype.getMode.call(planTask)).toBe("plan")
		expect(Task.prototype.getMode.call(actTask)).toBe("act")
	})

	/** Commit mode before rebuilding, waking the ask, and flushing persistence. */
	it("commits in atomic runtime order", async () => {
		const order: string[] = []
		const fakeTask = {
			taskSm: { setMode: vi.fn(() => order.push("mode")) },
			rebuildApiHandler: vi.fn(() => order.push("rebuild")),
			taskState: { isAwaitingPlanResponse: true, didRespondToPlanAskBySwitchingMode: false },
			handleWebviewAskResponse: vi.fn(async () => {
				order.push("wake")
			}),
			stateManager: {
				flushPendingState: vi.fn(async () => {
					order.push("flush")
				}),
			},
		}

		await Task.prototype.commitMode.call(fakeTask, "act", {
			message: "continue",
			images: ["image"],
			files: ["file"],
		})

		expect(order).toEqual(["mode", "rebuild", "wake", "flush"])
		expect(fakeTask.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "continue", ["image"], ["file"])
	})
})
