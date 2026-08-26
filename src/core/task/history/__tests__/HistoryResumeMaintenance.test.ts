import { describe, expect, it, vi } from "vitest"
import { HistoryResumeMaintenance } from "../HistoryResumeMaintenance"

describe("HistoryResumeMaintenance", () => {
	it("isolates stage failures and continues later maintenance", async () => {
		const order: string[] = []
		const reportFailure = vi.fn()
		const maintenance = new HistoryResumeMaintenance({
			cleanupLegacyStorage: async () => {
				order.push("cleanup")
				throw new Error("cleanup failed")
			},
			recoverInterruptedActivities: async () => {
				order.push("activities")
				return ["activity-1"]
			},
			patchInterruptedCommandCards: async (activityIds) => {
				order.push(`cards:${[...activityIds].join(",")}`)
				throw new Error("cards failed")
			},
			refreshTaskMetadata: async () => {
				order.push("metadata")
				throw new Error("metadata failed")
			},
			refreshContextIndicator: async () => {
				order.push("indicator")
			},
			reportFailure,
		})

		await maintenance.run()

		expect(order).toEqual(["cleanup", "activities", "cards:activity-1", "metadata", "indicator"])
		expect(reportFailure.mock.calls.map(([stage]) => stage)).toEqual([
			"legacy storage cleanup",
			"interrupted command card recovery",
			"task metadata refresh",
		])
	})

	it("skips command card patching when activity recovery fails", async () => {
		const order: string[] = []
		const patchInterruptedCommandCards = vi.fn(async () => undefined)
		const maintenance = new HistoryResumeMaintenance({
			cleanupLegacyStorage: async () => {
				order.push("cleanup")
			},
			recoverInterruptedActivities: async () => {
				order.push("activities")
				throw new Error("activity recovery failed")
			},
			patchInterruptedCommandCards,
			refreshTaskMetadata: async () => {
				order.push("metadata")
			},
			refreshContextIndicator: async () => {
				order.push("indicator")
			},
			reportFailure: vi.fn(),
		})

		await maintenance.run()

		expect(order).toEqual(["cleanup", "activities", "metadata", "indicator"])
		expect(patchInterruptedCommandCards).not.toHaveBeenCalled()
	})

	it("coalesces concurrent maintenance requests", async () => {
		let releaseCleanup: (() => void) | undefined
		const cleanupGate = new Promise<void>((resolve) => {
			releaseCleanup = resolve
		})
		const cleanupLegacyStorage = vi.fn(() => cleanupGate)
		const maintenance = new HistoryResumeMaintenance({
			cleanupLegacyStorage,
			recoverInterruptedActivities: vi.fn(async () => []),
			patchInterruptedCommandCards: vi.fn(async () => undefined),
			refreshTaskMetadata: vi.fn(async () => undefined),
			refreshContextIndicator: vi.fn(async () => undefined),
			reportFailure: vi.fn(),
		})

		const first = maintenance.run()
		const second = maintenance.run()
		expect(cleanupLegacyStorage).toHaveBeenCalledOnce()
		releaseCleanup?.()
		await Promise.all([first, second])
	})
})
