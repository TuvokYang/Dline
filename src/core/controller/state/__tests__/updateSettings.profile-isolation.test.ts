import { PlanActMode, UpdateSettingsRequest } from "@shared/proto/dline/state"
import { expect } from "chai"
import { describe, it, vi } from "vitest"
import type { Controller } from "../.."
import { updateSettings } from "../updateSettings"

/** Build a controller fixture with a task-local profile binding. */
function createController(): {
	controller: Controller
	clearTaskSetting: ReturnType<typeof vi.fn>
	rebuildApiHandler: ReturnType<typeof vi.fn>
} {
	const clearTaskSetting = vi.fn()
	const rebuildApiHandler = vi.fn()
	const controller = {
		stateManager: {
			setGlobalState: vi.fn(),
			getGlobalSettingsKey: vi.fn((key: string) => (key === "planActSeparateModelsSetting" ? true : undefined)),
			clearTaskSetting,
		},
		task: { taskId: "history-task", rebuildApiHandler },
		restartAccountUsagePolling: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as Controller
	return { controller, clearTaskSetting, rebuildApiHandler }
}

/** Verify global welcome defaults do not replace an active history task binding. */
describe("updateSettings profile isolation", () => {
	it("keeps task-local profiles when global defaults change", async () => {
		const { controller, clearTaskSetting, rebuildApiHandler } = createController()

		await updateSettings(controller, UpdateSettingsRequest.create({ planModeProfile: "global-plan", mode: PlanActMode.PLAN }))

		expect(clearTaskSetting.mock.calls).to.have.length(0)
		expect(rebuildApiHandler.mock.calls).to.have.length(0)
	})
})
