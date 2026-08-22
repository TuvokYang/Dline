import { NewTaskRequest } from "@shared/proto/dline/task"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from "../.."
import { newTask } from "../newTask"

describe("newTask", () => {
	it("returns after task admission while the agent loop continues in the background", async () => {
		const initTask = vi.fn(async () => "task-123")
		const controller = { initTask } as unknown as Controller
		const request = NewTaskRequest.create({
			text: "Start a long-running task",
			images: [],
			files: [],
		})

		const response = await newTask(controller, request)

		expect(response.value).toBe("task-123")
		expect(initTask).toHaveBeenCalledWith("Start a long-running task", [], [], undefined, {}, { startInBackground: true })
	})

	it("passes stable Profile identities into successor task settings", async () => {
		const initTask = vi.fn(async () => "task-successor")
		const controller = { initTask } as unknown as Controller
		const request = NewTaskRequest.create({
			text: "Start the successor",
			images: [],
			files: [],
			taskSettings: {
				planModeProfileId: "plan-profile-id",
				planModeProfile: "plan-profile",
				actModeProfileId: "act-profile-id",
				actModeProfile: "act-profile",
			},
		})

		await newTask(controller, request)

		expect(initTask).toHaveBeenCalledWith(
			"Start the successor",
			[],
			[],
			undefined,
			expect.objectContaining({
				planModeProfileId: "plan-profile-id",
				planModeProfile: "plan-profile",
				actModeProfileId: "act-profile-id",
				actModeProfile: "act-profile",
			}),
			{ startInBackground: true },
		)
	})
})
