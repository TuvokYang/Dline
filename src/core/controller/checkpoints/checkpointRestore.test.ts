import { CheckpointRestoreRequest } from "@shared/proto/dline/checkpoints"
import { describe, expect, it, vi } from "vitest"
import { checkpointRestore } from "./checkpointRestore"

interface RestoreControllerHarness {
	task: {
		taskState: { isInitialized: boolean }
		interrupt: ReturnType<typeof vi.fn>
		restoreContextCompactionCheckpoint: ReturnType<typeof vi.fn>
		checkpointManager: { restoreCheckpoint: ReturnType<typeof vi.fn> }
	}
}

function createController(): RestoreControllerHarness {
	return {
		task: {
			taskState: { isInitialized: true },
			interrupt: vi.fn().mockResolvedValue(undefined),
			restoreContextCompactionCheckpoint: vi.fn().mockResolvedValue({}),
			checkpointManager: {
				restoreCheckpoint: vi.fn().mockResolvedValue({}),
			},
		},
	}
}

describe("checkpointRestore controller", () => {
	it("restores files without interrupting the active chat runtime", async () => {
		const controller = createController()

		await checkpointRestore(controller as never, CheckpointRestoreRequest.create({ number: 42, restoreType: "workspace" }))

		expect(controller.task.interrupt).not.toHaveBeenCalled()
		expect(controller.task.checkpointManager.restoreCheckpoint).toHaveBeenCalledWith(42, "workspace", undefined, undefined)
	})

	it("routes a typed compaction Restore Chat request only through the durable compaction journal", async () => {
		const controller = createController()

		await checkpointRestore(
			controller as never,
			CheckpointRestoreRequest.create({
				number: 42,
				restoreType: "task",
				compactionOperationId: "operation-1",
				compactionCheckpointId: "sha256:pre-pass",
				compactionExpectedHeadCheckpointId: "sha256:post-pass",
				compactionExpectedChainRevision: 2,
			}),
		)

		expect(controller.task.interrupt).not.toHaveBeenCalled()
		expect(controller.task.restoreContextCompactionCheckpoint).toHaveBeenCalledWith(
			"operation-1",
			"sha256:pre-pass",
			"sha256:post-pass",
			2,
		)
		expect(controller.task.checkpointManager.restoreCheckpoint).not.toHaveBeenCalled()
	})

	it.each(["task", "taskAndWorkspace"] as const)("interrupts runtime before %s restore", async (restoreType) => {
		const controller = createController()

		await checkpointRestore(controller as never, CheckpointRestoreRequest.create({ number: 42, restoreType }))

		expect(controller.task.interrupt).toHaveBeenCalledOnce()
		expect(controller.task.checkpointManager.restoreCheckpoint).toHaveBeenCalledWith(42, restoreType, undefined, undefined)
	})
})
