import { describe, expect, it, vi } from "vitest"
import { Task } from "../index"

describe("Task.prepareFromHistory readiness", () => {
	it("publishes Resume and readiness before starting non-blocking maintenance", async () => {
		const order: string[] = []
		const maintenance = new Promise<void>(() => undefined)
		const task = {
			taskId: "task-1",
			taskState: { abort: false },
			resumeCoordinator: {
				prepare: vi.fn(async () => {
					order.push("resume")
				}),
			},
			startContextWindowEnvironmentRefresh: vi.fn(() => {
				order.push("environment")
			}),
			historyResumeMaintenance: {
				run: vi.fn(() => {
					order.push("maintenance")
					return maintenance
				}),
			},
		} as unknown as Task

		await Task.prototype.prepareFromHistory.call(task, {
			isCurrent: () => true,
			onReadyToDisplay: async () => {
				order.push("ready")
			},
		})

		expect(task.taskState.abort).toBe(true)
		expect(order).toEqual(["resume", "environment", "ready", "maintenance"])
	})

	it("does not start maintenance after readiness loses Task identity", async () => {
		let isCurrent = true
		const run = vi.fn(async () => undefined)
		const task = {
			taskId: "task-1",
			taskState: { abort: false },
			resumeCoordinator: { prepare: vi.fn(async () => undefined) },
			startContextWindowEnvironmentRefresh: vi.fn(),
			historyResumeMaintenance: { run },
		} as unknown as Task

		await Task.prototype.prepareFromHistory.call(task, {
			isCurrent: () => isCurrent,
			onReadyToDisplay: async () => {
				isCurrent = false
			},
		})

		expect(run).not.toHaveBeenCalled()
	})
})
