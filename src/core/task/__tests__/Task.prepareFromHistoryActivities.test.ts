import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { Task } from "../index"

describe("Task.prepareFromHistory activity recovery", () => {
	it("interrupts matching command cards before publishing the resumed history", async () => {
		const order: string[] = []
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "command",
				text: "npm run dev",
				activityId: "command-running",
				commandStatus: "running",
			},
			{
				ts: 2,
				type: "ask",
				ask: "command",
				text: "npm test",
				activityId: "command-pending",
				commandStatus: "pending",
			},
			{
				ts: 3,
				type: "say",
				say: "command",
				text: "npm run complete",
				activityId: "command-completed",
				commandStatus: "completed",
			},
		]
		const updateClineMessage = vi.fn(async (index: number, update: Partial<ClineMessage>) => {
			order.push(`message:${index}`)
			Object.assign(messages[index], update)
		})
		const task = {
			taskId: "task-1",
			taskState: { abort: false },
			activityStore: {
				recoverInterruptedActivities: vi.fn(async () => {
					order.push("activities")
					return ["command-running", "command-pending", "command-completed"]
				}),
			},
			messageStateHandler: { clineMessages: messages, updateClineMessage },
			resumeCoordinator: {
				prepare: vi.fn(async () => {
					order.push("resume")
				}),
			},
		} as unknown as Task

		await Task.prototype.prepareFromHistory.call(task)

		expect(task.taskState.abort).toBe(true)
		expect(messages.map((message) => message.commandStatus)).toEqual(["interrupted", "interrupted", "completed"])
		expect(order).toEqual(["activities", "message:0", "message:1", "resume"])
	})
})
