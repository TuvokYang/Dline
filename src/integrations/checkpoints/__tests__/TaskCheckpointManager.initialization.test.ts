import type CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.unmock("@integrations/checkpoints")

import { createTaskCheckpointManager } from "../index"

type CreateCheckpointTracker = (
	taskId: string,
	enableCheckpoints: boolean,
	workspacePath: string,
) => Promise<CheckpointTracker | undefined>

function createManager(createCheckpointTracker: CreateCheckpointTracker, initialError?: string) {
	const taskState: { taskId: string; checkpointManagerErrorMessage?: string } = {
		taskId: "task-1",
		...(initialError === undefined ? {} : { checkpointManagerErrorMessage: initialError }),
	}
	const setCheckpointTracker = vi.fn()
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const manager = createTaskCheckpointManager(
		{ taskId: "task-1", controller: {} } as never,
		{ enableCheckpoints: true, createCheckpointTracker },
		{
			fileContextTracker: {},
			diffViewProvider: {},
			messageStateHandler: { setCheckpointTracker },
			taskState,
			workspaceManager: { getPrimaryRoot: () => ({ path: "C:/workspace" }) },
		} as never,
		{
			updateTaskHistory: vi.fn(),
			cancelTask: vi.fn(),
			restoreChatRuntime: vi.fn(),
			say: vi.fn(),
			postStateToWebview,
		} as never,
		{ checkpointManagerErrorMessage: initialError },
	)
	return { manager, taskState, setCheckpointTracker, postStateToWebview }
}

describe("TaskCheckpointManager checkpoint initialization", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("retries a transient shadow initialization failure and clears the projected error", async () => {
		const tracker = { setTaskFileTracker: vi.fn() } as never
		const create = vi
			.fn<CreateCheckpointTracker>()
			.mockRejectedValueOnce(new Error("EBUSY: shadow index is locked"))
			.mockResolvedValueOnce(tracker)
		const harness = createManager(create, "Previous checkpoint initialization failed")

		const result = await harness.manager.retryCheckpointInitialization()

		expect(result).toBe(true)
		expect(create).toHaveBeenCalledTimes(2)
		expect(harness.setCheckpointTracker).toHaveBeenCalledWith(tracker)
		expect(harness.taskState.checkpointManagerErrorMessage).toBeUndefined()
		expect(harness.postStateToWebview).toHaveBeenCalled()
	})

	it("does not retry a permanent missing Git capability error", async () => {
		const create = vi.fn<CreateCheckpointTracker>().mockRejectedValue(new Error("Git must be installed to use checkpoints."))
		const harness = createManager(create)

		const result = await harness.manager.retryCheckpointInitialization()

		expect(result).toBe(false)
		expect(create).toHaveBeenCalledOnce()
		expect(harness.taskState.checkpointManagerErrorMessage).toContain("Git must be installed")
	})
})
