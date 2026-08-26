import { describe, expect, it, vi } from "vitest"
import { prepareHistoryTaskForDisplay } from "../history-task-readiness"

describe("history task readiness", () => {
	it("notifies readiness exactly once and stops when the callback replaces the current Task", async () => {
		let isCurrent = true
		const displayHistory = vi.fn(async () => undefined)
		const onReadyToDisplay = vi.fn(async () => {
			isCurrent = false
		})
		const prepareFromHistory = vi.fn(async (options?: { onReadyToDisplay?: () => Promise<void> }) => {
			await options?.onReadyToDisplay?.()
			await options?.onReadyToDisplay?.()
		})

		await expect(
			prepareHistoryTaskForDisplay({
				displayHistory,
				prepareFromHistory,
				hasTaskLock: true,
				isCurrent: () => isCurrent,
				onReadyToDisplay,
			}),
		).resolves.toBe(false)

		expect(displayHistory).toHaveBeenCalledOnce()
		expect(prepareFromHistory).toHaveBeenCalledOnce()
		expect(onReadyToDisplay).toHaveBeenCalledOnce()
	})

	it("does not prepare or notify after displayHistory loses Task identity", async () => {
		let isCurrent = true
		const displayHistory = vi.fn(async () => {
			isCurrent = false
		})
		const prepareFromHistory = vi.fn(async () => undefined)
		const onReadyToDisplay = vi.fn(async () => undefined)

		await expect(
			prepareHistoryTaskForDisplay({
				displayHistory,
				prepareFromHistory,
				hasTaskLock: true,
				isCurrent: () => isCurrent,
				onReadyToDisplay,
			}),
		).resolves.toBe(false)

		expect(prepareFromHistory).not.toHaveBeenCalled()
		expect(onReadyToDisplay).not.toHaveBeenCalled()
	})

	it("reveals readonly history after display without running interactive preparation", async () => {
		const displayHistory = vi.fn(async () => undefined)
		const prepareFromHistory = vi.fn(async () => undefined)
		const onReadyToDisplay = vi.fn(async () => undefined)

		await expect(
			prepareHistoryTaskForDisplay({
				displayHistory,
				prepareFromHistory,
				hasTaskLock: false,
				isCurrent: () => true,
				onReadyToDisplay,
			}),
		).resolves.toBe(true)

		expect(displayHistory).toHaveBeenCalledOnce()
		expect(prepareFromHistory).not.toHaveBeenCalled()
		expect(onReadyToDisplay).toHaveBeenCalledOnce()
	})
})
