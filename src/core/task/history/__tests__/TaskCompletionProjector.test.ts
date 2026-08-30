import { describe, expect, it, vi } from "vitest"
import { TaskPhase } from "../../TaskPhase"
import { TaskCompletionProjector } from "../TaskCompletionProjector"

function runtimeState(phase: TaskPhase, revision: number, completionId?: string) {
	return {
		phase,
		revision,
		completion: completionId ? { completionId } : undefined,
	}
}

describe("TaskCompletionProjector", () => {
	it("persists only authoritative completion state flips", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({ taskId: "task-1", persist })

		await expect(projector.sync(runtimeState(TaskPhase.STREAMING, 1))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 2, "completion-1"))).resolves.toBe(true)
		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 3, "completion-1"))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.STREAMING, 4))).resolves.toBe(true)

		expect(persist.mock.calls).toEqual([
			[{ taskId: "task-1", isCompleted: true, revision: 2 }],
			[{ taskId: "task-1", isCompleted: false, revision: 4 }],
		])
	})

	it("advances the local revision watermark without persisting an unchanged value", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({ taskId: "task-1", persist })

		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 2, "completion-1"))).resolves.toBe(true)
		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 5, "completion-1"))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.STREAMING, 4))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.STREAMING, 6))).resolves.toBe(true)

		expect(persist.mock.calls).toEqual([
			[{ taskId: "task-1", isCompleted: true, revision: 2 }],
			[{ taskId: "task-1", isCompleted: false, revision: 6 }],
		])
	})

	it("requires a completion identity before projecting completed", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({ taskId: "task-1", persist })

		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 2))).resolves.toBe(false)
		expect(persist).not.toHaveBeenCalled()
	})

	it("preserves a valid initial projection until the task leaves completed", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({
			taskId: "task-1",
			initial: { isCompleted: true, revision: 5 },
			persist,
		})

		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 6, "completion-1"))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.PAUSED, 7))).resolves.toBe(true)
		expect(persist).toHaveBeenCalledExactlyOnceWith({ taskId: "task-1", isCompleted: false, revision: 7 })
	})

	it("retries a failed persistence instead of accepting an in-memory-only projection", async () => {
		const persist = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValueOnce(true)
		const projector = new TaskCompletionProjector({ taskId: "task-1", persist })
		const completed = runtimeState(TaskPhase.COMPLETED, 2, "completion-1")

		await expect(projector.sync(completed)).rejects.toThrow("disk unavailable")
		await expect(projector.sync(completed)).resolves.toBe(true)
		expect(persist).toHaveBeenCalledTimes(2)
	})

	it("keeps a completed projection while a reopened task walks its startup phases", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({
			taskId: "task-1",
			initial: { isCompleted: true, revision: 12 },
			persist,
		})

		// A reopened task restarts its runtime revisions from zero and passes
		// through startup phases before its canonical state is hydrated.
		await expect(projector.sync(runtimeState(TaskPhase.IDLE, 0))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.INITIALIZING, 1))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.RESUMING, 2))).resolves.toBe(false)
		await expect(projector.sync(runtimeState(TaskPhase.COMPLETED, 3, "completion-1"))).resolves.toBe(false)

		expect(persist).not.toHaveBeenCalled()
	})

	it("lifts a restarted runtime revision above the durable watermark", async () => {
		const persist = vi.fn(async () => true)
		const projector = new TaskCompletionProjector({
			taskId: "task-1",
			initial: { isCompleted: true, revision: 12 },
			persist,
		})

		await expect(projector.sync(runtimeState(TaskPhase.STREAMING, 2))).resolves.toBe(true)

		// A revision of 2 would be rejected as stale by the durable store.
		expect(persist).toHaveBeenCalledExactlyOnceWith({ taskId: "task-1", isCompleted: false, revision: 13 })
	})

	it("does not advance the local projection when storage rejects a stale update", async () => {
		const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		const projector = new TaskCompletionProjector({ taskId: "task-1", persist })
		const completed = runtimeState(TaskPhase.COMPLETED, 2, "completion-1")

		await expect(projector.sync(completed)).resolves.toBe(false)
		await expect(projector.sync(completed)).resolves.toBe(true)
		expect(persist).toHaveBeenCalledTimes(2)
	})
})
