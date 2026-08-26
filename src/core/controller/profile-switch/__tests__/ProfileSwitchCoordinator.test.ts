import type { ApiHandler } from "@core/api"
import { ContextTransitionLease } from "@core/controller/context-transition/ContextTransitionLease"
import type { TaskCompactionRequest } from "@core/controller/context-transition/types"
import type { ChatContent } from "@shared/ChatContent"
import type { Mode } from "@shared/storage/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProfileSwitchCoordinator } from "../ProfileSwitchCoordinator"
import type { ProfileBindingResolver, ProfileCommitPort, ProfileSwitchOperation, ResolvedProfileTarget } from "../types"

interface DeferredValue<T> {
	promise: Promise<T>
	resolve: (value: T) => void
}

interface TestHarness {
	coordinator: ProfileSwitchCoordinator
	lease: ContextTransitionLease
	preflight: ReturnType<typeof vi.fn<(targetApi: ApiHandler, targetMode: Mode, chatContent?: ChatContent) => Promise<number>>>
	compact: ReturnType<typeof vi.fn<(request: TaskCompactionRequest) => Promise<"completed" | "cancelled" | "failed">>>
	release: ReturnType<typeof vi.fn<(operationId: string) => Promise<void>>>
	fail: ReturnType<typeof vi.fn<(operationId: string, reason: string) => Promise<void>>>
	validate: ReturnType<typeof vi.fn<(operation: ProfileSwitchOperation) => boolean>>
	commitProfile: ReturnType<typeof vi.fn<(operation: ProfileSwitchOperation) => Promise<void>>>
	resolveTarget: ReturnType<
		typeof vi.fn<(profileId: string, profileName: string, mode: Mode) => ResolvedProfileTarget | undefined>
	>
	setTaskId: (taskId: string | undefined) => void
}

const TARGET_API = { getModel: vi.fn() } as unknown as ApiHandler
const SOURCE_BINDINGS: Record<Mode, string> = { plan: "plan-source", act: "act-source" }

function createDeferred<T>(): DeferredValue<T> {
	let resolveValue: ((value: T) => void) | undefined
	const promise = new Promise<T>((resolve) => {
		resolveValue = resolve
	})
	return { promise, resolve: (value) => resolveValue?.(value) }
}

/** Build deterministic ports for one Profile transaction. */
function createHarness(
	options: { projectedUsageTokens?: number; currentMode?: Mode; lease?: ContextTransitionLease } = {},
): TestHarness {
	let taskId: string | undefined = "task-1"
	const currentMode = options.currentMode ?? "act"
	const lease = options.lease ?? new ContextTransitionLease()
	const resolveTarget = vi.fn<(profileId: string, profileName: string, mode: Mode) => ResolvedProfileTarget | undefined>(
		(profileId, profileName, mode) => ({
			profileId,
			profile: profileName,
			mode,
			contextWindow: 128_000,
			triggerTokens: 117_500,
			fittingExitTarget: 102_400,
			executionApi: TARGET_API,
		}),
	)
	const bindings: ProfileBindingResolver = {
		getCurrentMode: () => currentMode,
		getBinding: (mode) => SOURCE_BINDINGS[mode],
		resolveTarget,
	}
	const preflight = vi.fn<(targetApi: ApiHandler, targetMode: Mode, chatContent?: ChatContent) => Promise<number>>(
		async () => options.projectedUsageTokens ?? 128_001,
	)
	const compact = vi.fn<(request: TaskCompactionRequest) => Promise<"completed" | "cancelled" | "failed">>(
		async () => "completed",
	)
	const release = vi.fn<(operationId: string) => Promise<void>>(async () => undefined)
	const fail = vi.fn<(operationId: string, reason: string) => Promise<void>>(async () => undefined)
	const validate = vi.fn<(operation: ProfileSwitchOperation) => boolean>(() => true)
	const commitProfile = vi.fn<(operation: ProfileSwitchOperation) => Promise<void>>(async () => undefined)
	const commit: ProfileCommitPort = { validate, commit: commitProfile }
	const coordinator = new ProfileSwitchCoordinator({
		bindings,
		pressure: { read: preflight },
		compaction: { compact, complete: release, abort: fail },
		commit,
		lease,
		postState: vi.fn(async () => undefined),
		createId: () => "profile-operation-1",
		getTaskId: () => taskId,
	})

	return {
		coordinator,
		lease,
		preflight,
		compact,
		release,
		fail,
		validate,
		commitProfile,
		resolveTarget,
		setTaskId: (nextTaskId) => {
			taskId = nextTaskId
		},
	}
}

/** Verify confirmation-first Profile adoption independently from Controller and Task persistence. */
describe("ProfileSwitchCoordinator", () => {
	let harness: TestHarness

	beforeEach(() => {
		harness = createHarness()
	})

	it("commits an active binding directly below the compaction trigger", async () => {
		harness = createHarness({ projectedUsageTokens: 117_499 })

		const result = await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		expect(result).toEqual({ status: "switched", operationId: "profile-operation-1" })
		expect(harness.preflight).toHaveBeenCalledWith(TARGET_API, "act", undefined)
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.commitProfile).toHaveBeenCalledOnce()
		expect(harness.lease.getActive()).toBeUndefined()
	})

	it("does not preflight or rebuild through compaction when only an inactive binding changes", async () => {
		const result = await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["plan"],
		})

		expect(result.status).toBe("switched")
		expect(harness.resolveTarget).not.toHaveBeenCalled()
		expect(harness.preflight).not.toHaveBeenCalled()
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.commitProfile.mock.calls[0]?.[0].targetModes).toEqual(["plan"])
	})

	it("retains both bindings for one unified atomic commit while projecting only the active mode", async () => {
		harness = createHarness({ projectedUsageTokens: 117_499 })

		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["plan", "act"],
		})

		expect(harness.preflight).toHaveBeenCalledOnce()
		expect(harness.preflight).toHaveBeenCalledWith(TARGET_API, "act", undefined)
		expect(harness.commitProfile.mock.calls[0]?.[0].targetModes).toEqual(["plan", "act"])
	})

	it("requires confirmation when the active target candidate reaches the compaction trigger", async () => {
		harness = createHarness({ projectedUsageTokens: 117_500 })
		const result = await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		expect(result).toEqual({ status: "confirmation_required", operationId: "profile-operation-1" })
		expect(harness.commitProfile).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot()).toMatchObject({
			phase: "awaiting_confirmation",
			operationId: "profile-operation-1",
			sourceProfile: "act-source",
			targetProfile: "target-profile",
			activeMode: "act",
			currentTokens: 117_500,
			targetContextWindow: 128_000,
			fittingExitTarget: 102_400,
		})
	})

	it("adopts the selected target Profile before compacting with its handler", async () => {
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})
		const result = await harness.coordinator.confirm("profile-operation-1")

		expect(result.status).toBe("switched")
		expect(harness.compact).toHaveBeenCalledWith({
			trigger: "profile_switch",
			operationId: "profile-operation-1",
			targetApi: TARGET_API,
			targetMode: "act",
			chatContent: undefined,
			transition: expect.objectContaining({
				kind: "profile_switch",
				source: { mode: "act", profile: "target-profile" },
				sourceProfiles: { act: "target-profile" },
				target: { mode: "act", profile: "target-profile", contextWindow: 128_000 },
			}),
		})
		expect(harness.commitProfile).toHaveBeenCalledOnce()
		expect(harness.commitProfile.mock.invocationCallOrder[0]).toBeLessThan(harness.compact.mock.invocationCallOrder[0])
		expect(harness.release).toHaveBeenCalledWith("profile-operation-1")
		expect(harness.lease.getActive()).toBeUndefined()
	})

	it("cancels without adopting the target binding", async () => {
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})
		const result = await harness.coordinator.cancel("profile-operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.commitProfile).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot()).toEqual({ phase: "idle" })
		expect(harness.lease.getActive()).toBeUndefined()
	})

	it("keeps the adopted target Profile after target compaction fails", async () => {
		harness.compact.mockResolvedValueOnce("failed")
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})
		const result = await harness.coordinator.confirm("profile-operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.commitProfile).toHaveBeenCalledOnce()
		expect(harness.commitProfile.mock.invocationCallOrder[0]).toBeLessThan(harness.compact.mock.invocationCallOrder[0])
		expect(harness.coordinator.getSnapshot()).toMatchObject({ phase: "failed", targetAdopted: true })
		expect(harness.lease.getActive()).toBeUndefined()
	})

	it("reports failed adoption without claiming the target became active", async () => {
		harness.commitProfile.mockRejectedValueOnce(new Error("adoption failed"))
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		await expect(harness.coordinator.confirm("profile-operation-1")).resolves.toMatchObject({
			status: "rejected",
			error: "adoption failed",
		})
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.coordinator.getSnapshot()).toMatchObject({ phase: "failed", targetAdopted: false })
		expect(harness.lease.getActive()).toBeUndefined()
	})

	it("releases the shared transition lease when target compaction rejects", async () => {
		harness.compact.mockRejectedValueOnce(new Error("provider failed"))
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		await expect(harness.coordinator.confirm("profile-operation-1")).resolves.toMatchObject({
			status: "rejected",
			error: "provider failed",
		})
		expect(harness.lease.getActive()).toBeUndefined()

		await expect(
			harness.coordinator.request({
				taskId: "task-1",
				targetProfileId: "target-id",
				targetProfile: "target-profile",
				targetModes: ["act"],
			}),
		).resolves.toMatchObject({ status: "confirmation_required" })
	})

	it("releases the shared transition lease even when failure cleanup rejects", async () => {
		harness.compact.mockResolvedValueOnce("failed")
		harness.fail.mockRejectedValueOnce(new Error("rollback failed"))
		harness.release.mockRejectedValueOnce(new Error("release failed"))
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		await expect(harness.coordinator.confirm("profile-operation-1")).resolves.toMatchObject({ status: "rejected" })
		expect(harness.lease.getActive()).toBeUndefined()

		await expect(
			harness.coordinator.request({
				taskId: "task-1",
				targetProfileId: "target-id",
				targetProfile: "target-profile",
				targetModes: ["act"],
			}),
		).resolves.toMatchObject({ status: "confirmation_required" })
	})

	it("holds the shared transition lease while asynchronous preflight is unresolved", async () => {
		const deferred = createDeferred<number>()
		harness.preflight.mockReturnValueOnce(deferred.promise)
		const first = harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})
		await Promise.resolve()

		expect(harness.coordinator.getSnapshot()).toMatchObject({
			phase: "preflighting",
			operationId: "profile-operation-1",
			taskId: "task-1",
		})
		const second = await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "other-id",
			targetProfile: "other-profile",
			targetModes: ["act"],
		})

		expect(second).toEqual({ status: "in_progress", operationId: "profile-operation-1" })
		deferred.resolve(117_499)
		await expect(first).resolves.toMatchObject({ status: "switched" })
	})

	it("rejects Profile requests while a Mode transition owns the shared lease", async () => {
		harness.lease.acquire({ kind: "mode", operationId: "mode-operation-1", taskId: "task-1" })

		const result = await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})

		expect(result).toEqual({ status: "in_progress", operationId: "mode-operation-1" })
		expect(harness.preflight).not.toHaveBeenCalled()
	})

	it("rejects stale confirmation after the active task changes", async () => {
		await harness.coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
		})
		harness.setTaskId("task-2")

		const result = await harness.coordinator.confirm("profile-operation-1")

		expect(result.status).toBe("rejected")
		expect(harness.compact).not.toHaveBeenCalled()
		expect(harness.commitProfile).not.toHaveBeenCalled()
		expect(harness.lease.getActive()).toBeUndefined()
	})
})
