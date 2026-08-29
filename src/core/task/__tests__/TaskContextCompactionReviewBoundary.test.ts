import { describe, expect, it, vi } from "vitest"
import { Task } from "../index"

interface ReviewBoundary {
	reviewContextCompactionPass(
		input: { operationId: string; trigger: "task_header" | "manual_compact_command" },
		passIdentity: { passIndex: number },
		attempt: { attemptIndex: number; authorizationAttemptId: string },
		summary: string,
	): Promise<{ action: "accept" | "regenerate" }>
}

const reviewContextCompactionPass = (Task.prototype as unknown as ReviewBoundary).reviewContextCompactionPass

function createTask(interaction: { status: "awaiting" } | undefined) {
	const open = vi.fn(async () => ({ actionId: "confirm_utility" as const }))
	const interrupt = vi.fn(async () => ({ actionId: "confirm_utility" as const }))
	const task = {
		getRuntimeState: () => ({ interaction }),
		contextCompactionPresentation: { getUnitSnapshot: () => undefined },
		interactionCoordinator: { open, interrupt },
	} as unknown as Task
	return { task, open, interrupt }
}

describe("Task context compaction review boundary", () => {
	it("interrupts the active awaiting interaction for Task Header compaction", async () => {
		const { task, open, interrupt } = createTask({ status: "awaiting" })

		await reviewContextCompactionPass.call(
			task,
			{ operationId: "header-operation", trigger: "task_header" },
			{ passIndex: 0 },
			{ attemptIndex: 0, authorizationAttemptId: "attempt-header" },
			"Header summary",
		)

		expect(interrupt).toHaveBeenCalledOnce()
		expect(open).not.toHaveBeenCalled()
	})

	it("opens a review interaction after a slash command consumed its original interaction", async () => {
		const { task, open, interrupt } = createTask(undefined)

		await reviewContextCompactionPass.call(
			task,
			{ operationId: "slash-operation", trigger: "manual_compact_command" },
			{ passIndex: 0 },
			{ attemptIndex: 0, authorizationAttemptId: "attempt-slash" },
			"Slash summary",
		)

		expect(open).toHaveBeenCalledOnce()
		expect(interrupt).not.toHaveBeenCalled()
	})
})
