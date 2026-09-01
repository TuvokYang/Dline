import { describe, expect, it, vi } from "vitest"
import { prepareHistoryTaskForDisplay, projectHistoryPreparingView } from "../history-task-readiness"

describe("history task readiness", () => {
	it("projects a visible but non-dispatchable Resume action while preparing", () => {
		const view = projectHistoryPreparingView({ taskId: "task-1", phase: "initializing", revision: 3 })

		expect(view.activeInteraction).toBeUndefined()
		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([
			expect.objectContaining({ type: "resume", label: "Resume", enabled: false, dispatchTarget: "interaction" }),
		])
	})

	it("publishes a preparing surface before full historical display is ready", async () => {
		const order: string[] = []
		let releaseDisplay!: () => void
		const displayBlocked = new Promise<void>((resolve) => {
			releaseDisplay = resolve
		})
		const onPreparingToDisplay = vi.fn(async () => {
			order.push("preparing")
		})
		const displayHistory = vi.fn(async () => {
			order.push("display")
			await displayBlocked
		})
		const prepareFromHistory = vi.fn(async () => undefined)

		const readiness = prepareHistoryTaskForDisplay({
			displayHistory,
			prepareFromHistory,
			hasTaskLock: true,
			isCurrent: () => true,
			onPreparingToDisplay,
		} as Parameters<typeof prepareHistoryTaskForDisplay>[0] & {
			onPreparingToDisplay: () => Promise<void>
		})

		await vi.waitFor(() => expect(displayHistory).toHaveBeenCalledOnce())
		expect(order[0]).toBe("preparing")
		expect(onPreparingToDisplay).toHaveBeenCalledOnce()
		releaseDisplay()
		await readiness
	})

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
