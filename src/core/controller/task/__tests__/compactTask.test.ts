import { CompactTaskRequest } from "@shared/proto/dline/task"
import { describe, expect, it, vi } from "vitest"
import { compactTask } from "../compactTask"

interface CompactTask {
	taskId: string
	compactTask(expectedRevision: number): Promise<{ accepted: boolean; result: string }>
}

/** Create a controller-shaped test boundary with one optional active task. */
function controller(task?: CompactTask): { task?: CompactTask } {
	return task ? { task } : {}
}

describe("compactTask", () => {
	it("rejects a request when no task is active", async () => {
		const response = await compactTask(
			controller() as never,
			CompactTaskRequest.create({ taskId: "task-1", stateRevision: 7 }),
		)

		expect(response).toMatchObject({ accepted: false, result: "missing_task" })
	})

	it("rejects a request for a different active task without invoking compaction", async () => {
		const compact = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		const response = await compactTask(
			controller({ taskId: "task-1", compactTask: compact }) as never,
			CompactTaskRequest.create({ taskId: "task-2", stateRevision: 7 }),
		)

		expect(response).toMatchObject({ accepted: false, result: "missing_task" })
		expect(compact).not.toHaveBeenCalled()
	})

	it("forwards the task revision and preserves an accepted result", async () => {
		const compact = vi.fn(async (expectedRevision: number) => ({
			accepted: true,
			result: `accepted:${expectedRevision}`,
		}))
		const response = await compactTask(
			controller({ taskId: "task-1", compactTask: compact }) as never,
			CompactTaskRequest.create({ taskId: "task-1", stateRevision: 12 }),
		)

		expect(compact).toHaveBeenCalledOnce()
		expect(compact).toHaveBeenCalledWith(12)
		expect(response).toMatchObject({ accepted: true, result: "accepted:12" })
	})

	it("preserves a stale-state rejection from the task", async () => {
		const compact = vi.fn(async () => ({ accepted: false, result: "stale_state" }))
		const response = await compactTask(
			controller({ taskId: "task-1", compactTask: compact }) as never,
			CompactTaskRequest.create({ taskId: "task-1", stateRevision: 3 }),
		)

		expect(response).toMatchObject({ accepted: false, result: "stale_state" })
	})
})
