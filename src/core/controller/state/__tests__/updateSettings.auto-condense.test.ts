import { UpdateSettingsRequest } from "@shared/proto/dline/state"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from "../.."
import { updateSettings } from "../updateSettings"

function createController() {
	const setGlobalState = vi.fn()
	const controller = {
		configureGlobalComponents: vi.fn().mockResolvedValue({ components: [], durationMs: 0 }),
		stateManager: { setGlobalState },
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as Controller

	return { controller, setGlobalState }
}

describe("updateSettings auto-compact thresholds", () => {
	it("persists a valid percentage and maximum context", async () => {
		const { controller, setGlobalState } = createController()

		await updateSettings(
			controller,
			UpdateSettingsRequest.create({
				autoCondenseTriggerPercent: 60,
				autoCondenseMaxContextTokens: 500_000,
			}),
		)

		expect(setGlobalState).toHaveBeenCalledWith("autoCondenseTriggerPercent", 60)
		expect(setGlobalState).toHaveBeenCalledWith("autoCondenseMaxContextTokens", 500_000)
	})

	it.each([0, 98, 12.5])("rejects invalid trigger percentage %s", async (triggerPercent) => {
		const { controller, setGlobalState } = createController()

		await expect(
			updateSettings(controller, UpdateSettingsRequest.create({ autoCondenseTriggerPercent: triggerPercent })),
		).rejects.toThrow(/integer from 1 to 97 percent/i)
		expect(setGlobalState).not.toHaveBeenCalled()
	})

	it.each([-1, 1.5, 2_147_483_648])("rejects invalid maximum context %s", async (maxContextTokens) => {
		const { controller, setGlobalState } = createController()

		await expect(
			updateSettings(controller, UpdateSettingsRequest.create({ autoCondenseMaxContextTokens: maxContextTokens })),
		).rejects.toThrow(/integer from 0 to 2147483647 tokens/i)
		expect(setGlobalState).not.toHaveBeenCalled()
	})
})
