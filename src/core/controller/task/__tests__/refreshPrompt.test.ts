import { strict as assert } from "node:assert"
import { describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { refreshPrompt } from "../refreshPrompt"

describe("refreshPrompt", () => {
	it("logs and refreshes the active task prompt cache immediately", async () => {
		const debugSpy = vi.spyOn(Logger, "debug").mockImplementation(() => {})
		let refreshed = false
		const controller = {
			task: {
				taskId: "task-1",
				refreshPromptCache: async () => {
					refreshed = true
				},
			},
		}

		const response = await refreshPrompt(controller as never, { taskId: "task-1" })

		assert.equal(response.success, true)
		assert.equal(refreshed, true)
		expect(debugSpy).toHaveBeenCalledWith("[RefreshPrompt] requested taskId=task-1")
		expect(debugSpy).toHaveBeenCalledWith("[RefreshPrompt] refreshed taskId=task-1")
	})

	it("logs and rejects refresh when the requested task is not active", async () => {
		const debugSpy = vi.spyOn(Logger, "debug").mockImplementation(() => {})
		let refreshed = false
		const controller = {
			task: {
				taskId: "task-1",
				refreshPromptCache: async () => {
					refreshed = true
				},
			},
		}

		const response = await refreshPrompt(controller as never, { taskId: "task-2" })

		assert.equal(response.success, false)
		assert.equal(refreshed, false)
		expect(debugSpy).toHaveBeenCalledWith("[RefreshPrompt] requested taskId=task-2")
		expect(debugSpy).toHaveBeenCalledWith("[RefreshPrompt] rejected taskId=task-2 activeTaskId=task-1")
	})
})
