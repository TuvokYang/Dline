import { UpdateSettingsRequest } from "@shared/proto/dline/state"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from "../.."
import { updateSettings } from "../updateSettings"

function createController() {
	const setGlobalState = vi.fn()
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const controller = {
		stateManager: { setGlobalState },
		postStateToWebview,
	} as unknown as Controller

	return { controller, postStateToWebview, setGlobalState }
}

describe("updateSettings terminal command timeout", () => {
	it.each([60, 1800, 3600])("persists a valid %s-second deadline", async (timeoutSeconds) => {
		const { controller, postStateToWebview, setGlobalState } = createController()

		await updateSettings(controller, UpdateSettingsRequest.create({ terminalCommandTimeoutSeconds: timeoutSeconds }))

		expect(setGlobalState).toHaveBeenCalledWith("terminalCommandTimeoutSeconds", timeoutSeconds)
		expect(postStateToWebview).toHaveBeenCalledOnce()
	})

	it.each([0, 59])("rejects %s seconds because Settings has a one-minute minimum", async (timeoutSeconds) => {
		const { controller, setGlobalState } = createController()

		await expect(
			updateSettings(controller, UpdateSettingsRequest.create({ terminalCommandTimeoutSeconds: timeoutSeconds })),
		).rejects.toThrow(/at least 60 seconds/i)
		expect(setGlobalState).not.toHaveBeenCalled()
	})
})
