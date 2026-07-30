import { UpdateSettingsRequest } from "@shared/proto/dline/state"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from "../.."
import { updateSettings } from "../updateSettings"

function createController() {
	const setGlobalState = vi.fn()
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const configureGlobalComponents = vi.fn().mockResolvedValue({ components: [], durationMs: 0 })
	const controller = {
		configureGlobalComponents,
		stateManager: { setGlobalState },
		postStateToWebview,
	} as unknown as Controller

	return { configureGlobalComponents, controller, postStateToWebview, setGlobalState }
}

describe("updateSettings chat input shortcut", () => {
	it.each(["enter", "ctrlEnter", "shiftEnter"] as const)("persists %s", async (shortcut) => {
		const { configureGlobalComponents, controller, postStateToWebview, setGlobalState } = createController()

		await updateSettings(controller, UpdateSettingsRequest.create({ chatInputSendShortcut: shortcut }))

		expect(setGlobalState).toHaveBeenCalledWith("chatInputSendShortcut", shortcut)
		expect(configureGlobalComponents).toHaveBeenCalledOnce()
		expect(postStateToWebview).toHaveBeenCalledOnce()
	})

	it("rejects unsupported values", async () => {
		const { configureGlobalComponents, controller, setGlobalState } = createController()

		let error: unknown
		try {
			await updateSettings(controller, UpdateSettingsRequest.create({ chatInputSendShortcut: "unsupported" }))
		} catch (caught) {
			error = caught
		}

		expect(error).toBeInstanceOf(Error)
		expect(setGlobalState).not.toHaveBeenCalled()
		expect(configureGlobalComponents).not.toHaveBeenCalled()
	})
})
