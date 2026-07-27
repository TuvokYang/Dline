import { Task } from "@core/task"
import { describe, expect, it, vi } from "vitest"

type InitialCheckpointHashPersister = {
	persistCheckpointHashToMessage(messageIndex: number, commitHash: string): Promise<void>
}

describe("Task initial checkpoint hash persistence", () => {
	it("flushes the checkpoint row before publishing the updated state", async () => {
		const updateClineMessage = vi.fn().mockResolvedValue(undefined)
		const flushMessageUpdate = vi.fn().mockResolvedValue(undefined)
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const fakeTask = {
			messageStateHandler: { updateClineMessage, flushMessageUpdate },
			postStateToWebview,
		}

		await (Task.prototype as unknown as InitialCheckpointHashPersister).persistCheckpointHashToMessage.call(
			fakeTask,
			3,
			"initial-checkpoint-hash",
		)

		expect(updateClineMessage).toHaveBeenCalledWith(3, { lastCheckpointHash: "initial-checkpoint-hash" })
		expect(updateClineMessage.mock.invocationCallOrder[0]).toBeLessThan(flushMessageUpdate.mock.invocationCallOrder[0])
		expect(flushMessageUpdate.mock.invocationCallOrder[0]).toBeLessThan(postStateToWebview.mock.invocationCallOrder[0])
	})

	it("does not publish a checkpoint hash when its durable flush fails", async () => {
		const flushError = new Error("checkpoint_jsonl_flush_failed")
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const fakeTask = {
			messageStateHandler: {
				updateClineMessage: vi.fn().mockResolvedValue(undefined),
				flushMessageUpdate: vi.fn().mockRejectedValue(flushError),
			},
			postStateToWebview,
		}

		await expect(
			(Task.prototype as unknown as InitialCheckpointHashPersister).persistCheckpointHashToMessage.call(
				fakeTask,
				0,
				"initial-checkpoint-hash",
			),
		).rejects.toBe(flushError)
		expect(postStateToWebview).not.toHaveBeenCalled()
	})
})
