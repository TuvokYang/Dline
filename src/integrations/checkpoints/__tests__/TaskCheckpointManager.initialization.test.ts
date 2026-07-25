import type CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@/shared/ExtensionMessage"

vi.unmock("@integrations/checkpoints")

import { createTaskCheckpointManager } from "../index"

type CreateCheckpointTracker = (
	taskId: string,
	enableCheckpoints: boolean,
	workspacePath: string,
) => Promise<CheckpointTracker | undefined>

function createManager(
	createCheckpointTracker: CreateCheckpointTracker,
	initialError?: string,
	options?: { messages?: ClineMessage[]; tracker?: CheckpointTracker },
) {
	const taskState: { taskId: string; checkpointManagerErrorMessage?: string } = {
		taskId: "task-1",
		...(initialError === undefined ? {} : { checkpointManagerErrorMessage: initialError }),
	}
	const setCheckpointTracker = vi.fn()
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const say = vi.fn(async () => {
		const message: ClineMessage = { ts: 42, type: "say", say: "checkpoint_created" }
		options?.messages?.push(message)
		return message.ts
	})
	const manager = createTaskCheckpointManager(
		{ taskId: "task-1", controller: {} } as never,
		{ enableCheckpoints: true, createCheckpointTracker },
		{
			fileContextTracker: {},
			diffViewProvider: {},
			messageStateHandler: {
				clineMessages: options?.messages ?? [],
				setCheckpointTracker,
				updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			},
			taskState,
			workspaceManager: { getPrimaryRoot: () => ({ path: "C:/workspace" }) },
		} as never,
		{
			updateTaskHistory: vi.fn(),
			cancelTask: vi.fn(),
			restoreChatRuntime: vi.fn(),
			say,
			postStateToWebview,
		} as never,
		{
			checkpointManagerErrorMessage: initialError,
			...(options?.tracker ? { checkpointTracker: options.tracker } : {}),
		},
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

	it("binds the first chat checkpoint to the initialized shadow baseline when no files were tracked", async () => {
		const messages: ClineMessage[] = []
		const baselineHash = "shadow-baseline-hash"
		const tracker = {
			setTaskFileTracker: vi.fn(),
			commit: vi.fn().mockResolvedValue(baselineHash),
		} as unknown as CheckpointTracker
		const create = vi.fn<CreateCheckpointTracker>().mockResolvedValue(tracker)
		const harness = createManager(create, undefined, { messages, tracker })

		await harness.manager.saveCheckpoint()

		expect(tracker.commit).toHaveBeenCalledOnce()
		expect(messages).toEqual([
			expect.objectContaining({
				say: "checkpoint_created",
				lastCheckpointHash: baselineHash,
			}),
		])
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
