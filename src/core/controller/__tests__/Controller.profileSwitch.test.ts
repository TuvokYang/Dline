import type { ApiHandler } from "@core/api"
import { Controller } from "@core/controller"
import { ContextTransitionEngine } from "@core/controller/context-transition/ContextTransitionEngine"
import { ContextTransitionLease } from "@core/controller/context-transition/ContextTransitionLease"
import * as profileCatalog from "@core/controller/file/getApiProfiles"
import type { ProfileSwitchCoordinator } from "@core/controller/profile-switch/ProfileSwitchCoordinator"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** Verify the production Profile transition factory preserves the pending draft across preflight and compaction. */
describe("Controller Profile switch integration", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("durably commits stable global Profile identity when no Task is active", async () => {
		vi.spyOn(profileCatalog, "readApiProfiles").mockReturnValue([
			{ id: "target-id", name: "target-profile", enabled: true } as never,
		])
		const setGlobalStateBatch = vi.fn()
		const flushPendingState = vi.fn(async () => undefined)
		const request = vi.fn()
		const postStateToWebview = vi.fn(async () => undefined)
		const fakeController = {
			task: undefined,
			stateManager: {
				setGlobalStateBatch,
				flushPendingState,
			},
			profileSwitchCoordinator: { request },
			postStateToWebview,
		}

		const result = await Controller.prototype.requestProfileSwitch.call(fakeController, "target-id", ["plan", "act"])

		expect(result.status).toBe("switched")
		expect(setGlobalStateBatch).toHaveBeenCalledWith({
			planModeProfileId: "target-id",
			planModeProfile: "target-profile",
			actModeProfileId: "target-id",
			actModeProfile: "target-profile",
		})
		expect(flushPendingState).toHaveBeenCalledOnce()
		expect(postStateToWebview).toHaveBeenCalledWith({ immediate: true })
		expect(request).not.toHaveBeenCalled()
	})
	it("confirms against the occupied context window and adopts the target without compacting", async () => {
		const targetApi = { getModel: vi.fn() } as unknown as ApiHandler
		const draft = { message: "keep this draft", images: ["image"], files: ["file"] }
		const getOccupiedContextTokens = vi.fn(() => 128_001)
		const compact = vi.fn(async () => "completed" as const)
		const release = vi.fn()
		const commitProfileBindings = vi.fn(async () => undefined)
		const fakeController = {
			task: {
				taskId: "task-1",
				getMode: () => "act" as const,
				getOccupiedContextTokens,
				commitProfileBindings,
			},
			contextTransitionEngine: new ContextTransitionEngine({
				lease: new ContextTransitionLease(),
				compaction: {
					compact,
					complete: release,
					abort: vi.fn(async () => undefined),
				},
				postState: vi.fn(async () => undefined),
				createId: () => "profile-operation-1",
			}),
			resolveTaskProfileName: vi.fn(() => "source-profile"),
			resolveProfileTarget: vi.fn(() => ({
				profileId: "target-id",
				profile: "target-profile",
				mode: "act" as const,
				contextWindow: 128_000,
				triggerTokens: 117_500,
				fittingExitTarget: 102_400,
				executionApi: targetApi,
			})),
			validateProfileSwitch: vi.fn(() => true),
			postStateToWebview: vi.fn(async () => undefined),
		}
		const createProfileSwitchCoordinator = Reflect.get(Controller.prototype, "createProfileSwitchCoordinator") as (
			this: typeof fakeController,
		) => ProfileSwitchCoordinator
		const coordinator = createProfileSwitchCoordinator.call(fakeController)

		const request = await coordinator.request({
			taskId: "task-1",
			targetProfileId: "target-id",
			targetProfile: "target-profile",
			targetModes: ["act"],
			chatContent: draft,
		})

		expect(request).toEqual({ status: "confirmation_required", operationId: "profile-operation-1" })
		expect(getOccupiedContextTokens).toHaveBeenCalledOnce()

		await expect(coordinator.confirm("profile-operation-1")).resolves.toEqual({
			status: "switched",
			operationId: "profile-operation-1",
		})
		expect(compact).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
		expect(commitProfileBindings).toHaveBeenCalledWith({ profileId: "target-id", profileName: "target-profile" }, ["act"])
	})
})
