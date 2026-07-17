import type { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import { describe, it, vi } from "vitest"
import type { Controller } from "@/core/controller"
import { ProfileChangeCoordinator } from "../ProfileChangeCoordinator"

/** Build a controller fixture bound to the supplied plan and act profiles. */
function createController(planProfile: string, actProfile: string): Controller {
	return {
		task: {
			taskSm: {
				planModeProfile: planProfile,
				actModeProfile: actProfile,
				mode: "act",
				setPlanModeProfile: vi.fn(function (this: { planModeProfile: string }, value: string) {
					this.planModeProfile = value
				}),
				setActModeProfile: vi.fn(function (this: { actModeProfile: string }, value: string) {
					this.actModeProfile = value
				}),
			},
			rebuildApiHandler: vi.fn(),
		},
		stateManager: {
			getGlobalSettingsKey: vi.fn((key: string) => (key === "planModeProfile" ? planProfile : actProfile)),
			setGlobalState: vi.fn(),
		},
		restartAccountUsagePolling: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as Controller
}

/** Verify profile changes rebuild only affected tasks while refreshing all Webviews. */
describe("ProfileChangeCoordinator", () => {
	it("broadcasts profile revisions and selectively rebuilds handlers", async () => {
		const first = createController("shared-profile", "shared-profile")
		const second = createController("other-profile", "shared-profile")
		const third = createController("other-profile", "other-profile")
		const coordinator = new ProfileChangeCoordinator(() => [first, second, third])
		const oldProfiles = [{ id: "shared-id", name: "shared-profile" }] as ApiProfile[]
		const nextProfiles = [{ id: "shared-id", name: "shared-profile", modelId: "new-model" }] as ApiProfile[]

		await coordinator.publish(oldProfiles, nextProfiles)

		expect((first.task?.rebuildApiHandler as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
		expect((second.task?.rebuildApiHandler as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
		expect((third.task?.rebuildApiHandler as ReturnType<typeof vi.fn>).mock.calls).to.have.length(0)
		expect((first.postStateToWebview as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
		expect((second.postStateToWebview as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
		expect((third.postStateToWebview as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
		expect(coordinator.revision).to.equal(1)
	})

	it("remaps task profile names before rebuilding after a provider change", async () => {
		const controller = createController("old-profile", "old-profile")
		const coordinator = new ProfileChangeCoordinator(() => [controller])
		const oldProfiles = [{ id: "profile-id", name: "old-profile", provider: "openai" }] as ApiProfile[]
		const nextProfiles = [{ id: "profile-id", name: "deepseek:new-model", provider: "deepseek" }] as ApiProfile[]

		await coordinator.publish(oldProfiles, nextProfiles)

		expect(controller.task?.taskSm.planModeProfile).to.equal("deepseek:new-model")
		expect(controller.task?.taskSm.actModeProfile).to.equal("deepseek:new-model")
		expect((controller.task?.rebuildApiHandler as ReturnType<typeof vi.fn>).mock.calls).to.have.length(1)
	})
})
