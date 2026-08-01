import type { ChatContent } from "@shared/ChatContent"
import type { Mode } from "@shared/storage/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModeSwitchCoordinator } from "../ModeSwitchCoordinator"
import type {
	ContextPressureReader,
	ModeCommitPort,
	ModeProfileResolver,
	ModeSwitchOperation,
	ResolvedModeProfile,
	TaskCompactionPort,
} from "../types"

interface TestHarness {
	coordinator: ModeSwitchCoordinator
	profiles: ModeProfileResolver
	pressure: ContextPressureReader
	compaction: TaskCompactionPort
	commit: ModeCommitPort
	postState: ReturnType<typeof vi.fn<() => Promise<void>>>
	compact: ReturnType<
		typeof vi.fn<(operationId: string, chatContent?: ChatContent) => Promise<"completed" | "cancelled" | "failed">>
	>
	release: ReturnType<typeof vi.fn<(operationId: string) => void>>
	fail: ReturnType<typeof vi.fn<(operationId: string, reason: string) => void>>
	validate: ReturnType<typeof vi.fn<(operation: ModeSwitchOperation) => boolean>>
	commitMode: ReturnType<typeof vi.fn<(operation: ModeSwitchOperation) => Promise<void>>>
	setTaskId: (taskId: string | undefined) => void
}

const SOURCE: ResolvedModeProfile = {
	mode: "plan",
	profile: "large",
	contextWindow: 272_000,
}

const TARGET: ResolvedModeProfile = {
	mode: "act",
	profile: "small",
	contextWindow: 128_000,
}

/** Build deterministic ports for one coordinator test. */
function createHarness(currentTokens = 125_000): TestHarness {
	let taskId: string | undefined = "task-1"
	const resolve = vi.fn<(mode: Mode) => ResolvedModeProfile | undefined>((mode) => (mode === "plan" ? SOURCE : TARGET))
	const profiles: ModeProfileResolver = { getSource: () => SOURCE, resolve }
	const pressure: ContextPressureReader = { read: vi.fn(() => currentTokens) }
	const compact = vi.fn<(operationId: string, chatContent?: ChatContent) => Promise<"completed" | "cancelled" | "failed">>(
		async () => "completed",
	)
	const release = vi.fn<(operationId: string) => void>()
	const fail = vi.fn<(operationId: string, reason: string) => void>()
	const compaction: TaskCompactionPort = { compact, release, fail }
	const validate = vi.fn<(operation: ModeSwitchOperation) => boolean>(() => true)
	const commitMode = vi.fn<(operation: ModeSwitchOperation) => Promise<void>>(async () => {})
	const commit: ModeCommitPort = { validate, commit: commitMode }
	const postState = vi.fn<() => Promise<void>>(async () => {})
	const coordinator = new ModeSwitchCoordinator({
		profiles,
		pressure,
		compaction,
		commit,
		postState,
		createId: () => "operation-1",
		getTaskId: () => taskId,
	})
	return {
		coordinator,
		profiles,
		pressure,
		compaction,
		commit,
		postState,
		compact,
		release,
		fail,
		validate,
		commitMode,
		setTaskId: (nextTaskId) => {
			taskId = nextTaskId
		},
	}
}

/** Verify the coordinator transaction matrix independently from Controller and Task. */
describe("ModeSwitchCoordinator", () => {
	let harness: TestHarness

	/** Create fresh deterministic ports for every scenario. */
	beforeEach(() => {
		harness = createHarness()
	})

	/** Directly commit when current pressure is below the smaller target trigger. */
	it("switches directly below the target trigger", async () => {
		harness = createHarness(100_000)
		const result = await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })

		expect(result).toEqual({ status: "switched", operationId: "operation-1" })
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.commitMode).toHaveBeenCalledOnce()
		expect(harness.coordinator.getSnapshot()).toEqual({ phase: "idle" })
	})

	/** Directly commit when source and target profiles are identical. */
	it("switches directly for the same profile", async () => {
		const sharedProfile: ModeProfileResolver = {
			getSource: () => ({ ...SOURCE, profile: "shared" }),
			resolve: (mode) => ({ ...SOURCE, mode, profile: "shared" }),
		}
		harness.coordinator = new ModeSwitchCoordinator({
			profiles: sharedProfile,
			pressure: harness.pressure,
			compaction: harness.compaction,
			commit: harness.commit,
			postState: harness.postState,
			createId: () => "operation-1",
			getTaskId: () => "task-1",
		})

		const result = await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })

		expect(result.status).toBe("switched")
		expect(harness.compact).not.toHaveBeenCalled()
	})

	/** Project confirmation details without committing target mode. */
	it("requests confirmation for overflowing smaller target", async () => {
		const result = await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })

		expect(result).toEqual({ status: "confirmation_required", operationId: "operation-1" })
		expect(harness.coordinator.getSnapshot()).toMatchObject({
			phase: "awaiting_confirmation",
			operationId: "operation-1",
			taskId: "task-1",
			sourceMode: "plan",
			targetMode: "act",
			currentTokens: 125_000,
		})
		expect(harness.commitMode).not.toHaveBeenCalled()
	})

	/** Cancel only the active awaiting-confirmation transaction. */
	it("cancels an awaiting confirmation", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.cancel("operation-1")

		expect(result).toEqual({ status: "rejected", operationId: "operation-1", error: "Mode switch cancelled." })
		expect(harness.coordinator.getSnapshot()).toEqual({ phase: "idle" })
	})

	/** Compact before committing and release only after commit succeeds. */
	it("compacts then commits and releases", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.confirm("operation-1")

		expect(result).toEqual({ status: "switched", operationId: "operation-1" })
		expect(harness.compact).toHaveBeenCalledWith("operation-1", undefined)
		expect(harness.commitMode).toHaveBeenCalledOnce()
		expect(harness.release).toHaveBeenCalledWith("operation-1")
		expect(harness.coordinator.getSnapshot()).toEqual({ phase: "idle" })
	})

	/** Preserve source mode and expose a retryable failure when compaction fails. */
	it("does not commit after compact failure", async () => {
		harness.compact.mockResolvedValueOnce("failed")
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.confirm("operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.commitMode).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot()).toMatchObject({ phase: "failed", operationId: "operation-1" })
	})

	/** Preserve source mode when the compaction hook cancels the operation. */
	it("does not commit after compact cancellation", async () => {
		harness.compact.mockResolvedValueOnce("cancelled")
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.confirm("operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.commitMode).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot()).toMatchObject({ phase: "failed" })
	})

	/** Reject confirmation from an older dialog without mutating active state. */
	it("rejects a stale confirm operation id", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.confirm("stale-operation")

		expect(result.status).toBe("rejected")
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot().phase).toBe("awaiting_confirmation")
	})

	/** Reject cancellation from an older dialog without mutating active state. */
	it("rejects a stale cancel operation id", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.cancel("stale-operation")

		expect(result.status).toBe("rejected")
		expect(harness.coordinator.getSnapshot().phase).toBe("awaiting_confirmation")
	})

	/** Reject a second request until the active transaction reaches a terminal state. */
	it("rejects re-entry while confirmation is pending", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })

		expect(result).toEqual({ status: "in_progress", operationId: "operation-1" })
	})

	/** Reject requests that do not match the current task identity. */
	it("rejects a request for a stale task", async () => {
		const result = await harness.coordinator.request({ taskId: "task-2", targetMode: "act" })

		expect(result.status).toBe("rejected")
		expect(harness.commitMode).not.toHaveBeenCalled()
	})

	/** Stop before compaction when task identity changes after confirmation was shown. */
	it("rejects confirm after task change", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		harness.setTaskId("task-2")
		const result = await harness.coordinator.confirm("operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot().phase).toBe("failed")
	})

	/** Revalidate source state before compaction starts. */
	it("rejects confirm after source validation fails", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		harness.validate.mockReturnValueOnce(false)
		const result = await harness.coordinator.confirm("operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.compact).not.toHaveBeenCalled()
	})

	/** Fail and release the compaction barrier if target commit throws. */
	it("cleans up after commit failure", async () => {
		harness.commitMode.mockRejectedValueOnce(new Error("commit failed"))
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		const result = await harness.coordinator.confirm("operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.fail).toHaveBeenCalledWith("operation-1", "commit failed")
		expect(harness.release).toHaveBeenCalledWith("operation-1")
		expect(harness.coordinator.getSnapshot()).toMatchObject({ phase: "failed", error: "commit failed" })
	})

	/** Clear a failed transaction when a fresh request is made. */
	it("allows a new request after failure", async () => {
		harness.compact.mockResolvedValueOnce("failed")
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		await harness.coordinator.confirm("operation-1")
		harness.compact.mockResolvedValueOnce("completed")

		const result = await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })

		expect(result.status).toBe("confirmation_required")
		expect(harness.coordinator.getSnapshot().phase).toBe("awaiting_confirmation")
	})

	/** Reset active state and release task resources during lifecycle cleanup. */
	it("resets an active operation", async () => {
		await harness.coordinator.request({ taskId: "task-1", targetMode: "act" })
		await harness.coordinator.reset()

		expect(harness.fail).toHaveBeenCalledWith("operation-1", "Mode switch reset.")
		expect(harness.release).toHaveBeenCalledWith("operation-1")
		expect(harness.coordinator.getSnapshot()).toEqual({ phase: "idle" })
	})
})
