import { Controller } from "@core/controller"
import { describe, expect, it, vi } from "vitest"

describe("Controller New Task successor ownership", () => {
	it("starts the successor only while the source Task still owns the surface", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		Object.assign(controller as unknown as Record<string, unknown>, { task: { taskId: "task-old" } })
		const clearTask = vi.fn(async () => undefined)
		vi.spyOn(controller, "runTaskLifecycleOperation").mockImplementation(async (operation) => operation({ clearTask }))
		const initTask = vi.spyOn(controller, "initTask").mockResolvedValue("task-new")
		const initialUserContent = [{ type: "text" as const, text: "<feedback>\nContinue narrowly\n</feedback>" }]

		const taskId = await controller.startSuccessorTask(
			"task-old",
			"Successor context",
			{ mode: "act", planModeProfile: "plan-old", actModeProfile: "act-old" },
			initialUserContent,
		)

		expect(taskId).toBe("task-new")
		expect(clearTask).toHaveBeenCalledWith({ suppressPostState: true })
		expect(initTask).toHaveBeenCalledWith(
			"Successor context",
			undefined,
			undefined,
			undefined,
			{ mode: "act", planModeProfile: "plan-old", actModeProfile: "act-old" },
			{
				startInBackground: true,
				initialUserContent,
				skipInitialClear: true,
			},
		)
	})

	it("does not clear a different Task loaded before the deferred successor effect runs", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		Object.assign(controller as unknown as Record<string, unknown>, { task: { taskId: "task-user-opened" } })
		const clearTask = vi.fn(async () => undefined)
		vi.spyOn(controller, "runTaskLifecycleOperation").mockImplementation(async (operation) => operation({ clearTask }))
		const initTask = vi.spyOn(controller, "initTask").mockResolvedValue("task-new")

		const taskId = await controller.startSuccessorTask("task-old", "Successor context", { mode: "plan" }, [])

		expect(taskId).toBeUndefined()
		expect(clearTask).not.toHaveBeenCalled()
		expect(initTask).not.toHaveBeenCalled()
	})
})
