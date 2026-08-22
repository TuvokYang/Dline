import { PlanActMode, UpdateSettingsRequest, UpdateTaskSettingsRequest } from "@shared/proto/dline/state"
import { expect } from "chai"
import { describe, it, vi } from "vitest"
import type { Controller } from "../.."
import { updateSettings } from "../updateSettings"
import { updateTaskSettings } from "../updateTaskSettings"

/** Build a controller fixture with a task-local profile binding. */
function createController(): {
	controller: Controller
	clearTaskSetting: ReturnType<typeof vi.fn>
	configureGlobalComponents: ReturnType<typeof vi.fn>
	rebuildApiHandler: ReturnType<typeof vi.fn>
} {
	const clearTaskSetting = vi.fn()
	const configureGlobalComponents = vi.fn().mockResolvedValue({ components: [], durationMs: 0 })
	const rebuildApiHandler = vi.fn()
	const controller = {
		configureGlobalComponents,
		stateManager: {
			flushPendingState: vi.fn().mockResolvedValue(undefined),
			setGlobalState: vi.fn(),
			getGlobalSettingsKey: vi.fn((key: string) => (key === "planActSeparateModelsSetting" ? true : undefined)),
			clearTaskSetting,
		},
		task: { taskId: "history-task", rebuildApiHandler },
		restartAccountUsagePolling: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as Controller
	return { controller, clearTaskSetting, configureGlobalComponents, rebuildApiHandler }
}

/** Verify global welcome defaults do not replace an active history task binding. */
describe("updateSettings profile isolation", () => {
	it("keeps task-local profiles when global defaults change", async () => {
		const { controller, clearTaskSetting, configureGlobalComponents, rebuildApiHandler } = createController()

		await updateSettings(controller, UpdateSettingsRequest.create({ planModeProfile: "global-plan", mode: PlanActMode.PLAN }))

		expect(clearTaskSetting.mock.calls).to.have.length(0)
		expect(rebuildApiHandler.mock.calls).to.have.length(0)
		expect(configureGlobalComponents.mock.calls).to.have.length(1)
	})

	it("collapses active task bindings when Profile split is disabled", async () => {
		const commitProfileBindings = vi.fn().mockResolvedValue(undefined)
		const controller = {
			configureGlobalComponents: vi.fn().mockResolvedValue({ components: [], durationMs: 0 }),
			stateManager: {
				flushPendingState: vi.fn().mockResolvedValue(undefined),
				setGlobalState: vi.fn(),
				setGlobalStateBatch: vi.fn(),
				getCanonicalSettingsKey: vi.fn((key: string) => (key === "planActSeparateModelsSetting" ? true : undefined)),
				getGlobalSettingsKey: vi.fn((key: string) => (key === "planActSeparateModelsSetting" ? true : undefined)),
			},
			task: {
				commitProfileBindings,
				taskSm: {
					mode: "act",
					actModeProfileId: "act-profile-id",
					actModeProfile: "act-profile",
				},
			},
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		} as unknown as Controller

		await updateSettings(controller, UpdateSettingsRequest.create({ planActSeparateModelsSetting: false }))

		expect(commitProfileBindings.mock.calls).to.deep.equal([
			[{ profileId: "act-profile-id", profileName: "act-profile" }, ["plan", "act"]],
		])
	})
})

describe("updateTaskSettings account usage", () => {
	it("clears and refreshes usage when the active task profile changes", async () => {
		const restartAccountUsagePolling = vi.fn()
		const rebuildApiHandler = vi.fn()
		const controller = {
			stateManager: {
				flushPendingState: vi.fn().mockResolvedValue(undefined),
				setTaskSettingsBatch: vi.fn(),
				setTaskSettings: vi.fn(),
			},
			task: { taskId: "task-1", rebuildApiHandler },
			restartAccountUsagePolling,
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		} as unknown as Controller

		await updateTaskSettings(
			controller,
			UpdateTaskSettingsRequest.create({ taskId: "task-1", settings: { actModeProfile: "codex-profile" } }),
		)

		expect(rebuildApiHandler.mock.calls).to.have.length(1)
		expect(restartAccountUsagePolling.mock.calls).to.have.length(1)
	})
})
