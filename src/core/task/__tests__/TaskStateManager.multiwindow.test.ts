import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "should"
import { createStorageContext } from "@shared/storage/storage-context"
import * as chai from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { TaskStateManager } from "../TaskStateManager"

describe("TaskStateManager - Multi-window Profile Isolation", () => {
	let tempDir: string
	let sm: StateManager

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-task-state-manager-"))
		vi.stubEnv("DLINE_DOCS_DIR", tempDir)
		expect(process.env.DLINE_DOCS_DIR).toBe(tempDir)
		const storageCtx = createStorageContext({ clineDir: tempDir })
		sm = await StateManager.initialize(storageCtx)
	})

	afterEach(async () => {
		await StateManager.resetForTest()
		vi.unstubAllEnvs()
		await fs.rm(tempDir, { recursive: true, force: true })
		await expect(fs.access(tempDir)).rejects.toMatchObject({ code: "ENOENT" })
	})

	it("should isolate profile settings between two tasks without activeTaskId interference", async () => {
		// Simulate two tasks (representing two windows)
		await sm.loadTaskSettings("task-window-1")
		await sm.loadTaskSettings("task-window-2")

		// Create TaskStateManager instances for each task
		const taskSm1 = new TaskStateManager("task-window-1", sm)
		const taskSm2 = new TaskStateManager("task-window-2", sm)

		// Window 1 sets its profile to "anthropic"
		taskSm1.setPlanModeProfile("anthropic")
		taskSm1.setActModeProfile("anthropic-act")

		// Window 2 sets its profile to "openai"
		taskSm2.setPlanModeProfile("openai")
		taskSm2.setActModeProfile("openai-act")

		// Verify isolation: each task reads its own profile
		taskSm1.planModeProfile?.should.equal("anthropic")
		taskSm1.actModeProfile?.should.equal("anthropic-act")
		taskSm2.planModeProfile?.should.equal("openai")
		taskSm2.actModeProfile?.should.equal("openai-act")

		// Simulate activeTaskId switching (what Controller does when posting state)
		sm.setActiveTaskId("task-window-1")
		sm.setActiveTaskId("task-window-2")
		sm.setActiveTaskId("task-window-1")

		// After activeTaskId switching, TaskStateManager should still read correct values
		taskSm1.planModeProfile?.should.equal("anthropic")
		taskSm1.actModeProfile?.should.equal("anthropic-act")
		taskSm2.planModeProfile?.should.equal("openai")
		taskSm2.actModeProfile?.should.equal("openai-act")
	})

	it("should return undefined for profiles when not set at task level", () => {
		const taskSm = new TaskStateManager("task-new", sm)

		// Should return undefined, allowing fallback to global settings
		chai.expect(taskSm.planModeProfile).to.be.undefined
		chai.expect(taskSm.actModeProfile).to.be.undefined
	})

	it("should keep persisted history profiles when global defaults change", async () => {
		await sm.loadTaskSettings("task-history")
		const taskSm = new TaskStateManager("task-history", sm)
		taskSm.setPlanModeProfile("history-plan")
		taskSm.setActModeProfile("history-act")
		sm.setGlobalState("planModeProfile", "global-plan")
		sm.setGlobalState("actModeProfile", "global-act")

		const effectiveConfig = {
			...sm.getApiConfiguration(),
			...(taskSm.planModeProfile !== undefined && { planModeProfile: taskSm.planModeProfile }),
			...(taskSm.actModeProfile !== undefined && { actModeProfile: taskSm.actModeProfile }),
		}

		effectiveConfig.planModeProfile?.should.equal("history-plan")
		effectiveConfig.actModeProfile?.should.equal("history-act")
	})

	it("should persist profile changes via markTaskSettingDirty", async () => {
		await sm.loadTaskSettings("task-persist")
		const taskSm = new TaskStateManager("task-persist", sm)

		taskSm.setPlanModeProfile("claude-3.5")
		taskSm.setActModeProfile("gpt-4")

		// Flush to ensure persistence
		await sm.flushPendingState()

		// Create a new TaskStateManager instance to verify persistence
		const taskSm2 = new TaskStateManager("task-persist", sm)
		taskSm2.planModeProfile?.should.equal("claude-3.5")
		taskSm2.actModeProfile?.should.equal("gpt-4")
	})

	it("should handle concurrent profile updates from multiple windows", () => {
		// Simulate rapid concurrent updates (race condition scenario)
		const taskSm1 = new TaskStateManager("task-race-1", sm)
		const taskSm2 = new TaskStateManager("task-race-2", sm)
		const taskSm3 = new TaskStateManager("task-race-3", sm)

		// All three windows update at the same time
		taskSm1.setPlanModeProfile("profile-1")
		taskSm2.setPlanModeProfile("profile-2")
		taskSm3.setPlanModeProfile("profile-3")

		// Each should maintain its own value
		taskSm1.planModeProfile?.should.equal("profile-1")
		taskSm2.planModeProfile?.should.equal("profile-2")
		taskSm3.planModeProfile?.should.equal("profile-3")

		// Simulate activeTaskId thrashing
		for (let i = 0; i < 10; i++) {
			sm.setActiveTaskId("task-race-1")
			sm.setActiveTaskId("task-race-2")
			sm.setActiveTaskId("task-race-3")
		}

		// Values should remain stable
		taskSm1.planModeProfile?.should.equal("profile-1")
		taskSm2.planModeProfile?.should.equal("profile-2")
		taskSm3.planModeProfile?.should.equal("profile-3")
	})
})
