import { describe, expect, it, vi } from "vitest"
import { saveSettingsAndClose } from "./settingsSaveCoordinator"

describe("saveSettingsAndClose", () => {
	it("completes every persistence boundary before closing the Settings view", async () => {
		const order: string[] = []
		const flushInputs = vi.fn(async () => {
			order.push("inputs")
		})
		const flushRequests = vi.fn(async () => {
			order.push("requests")
		})
		const flushBackend = vi.fn(async () => {
			order.push("backend")
		})
		const close = vi.fn(async () => {
			order.push("close")
		})

		await saveSettingsAndClose({ flushInputs, flushRequests, flushBackend, close })

		expect(order).toEqual(["inputs", "requests", "backend", "close"])
	})

	it("does not close or cross later persistence boundaries after a save failure", async () => {
		const flushInputs = vi.fn().mockResolvedValue(undefined)
		const flushRequests = vi.fn().mockRejectedValue(new Error("Settings request failed"))
		const flushBackend = vi.fn().mockResolvedValue(undefined)
		const close = vi.fn().mockResolvedValue(undefined)

		await expect(saveSettingsAndClose({ flushInputs, flushRequests, flushBackend, close })).rejects.toThrow(
			"Settings request failed",
		)

		expect(flushInputs).toHaveBeenCalledOnce()
		expect(flushRequests).toHaveBeenCalledOnce()
		expect(flushBackend).not.toHaveBeenCalled()
		expect(close).not.toHaveBeenCalled()
	})
})
