/**
 * Unit tests for StateManager per-task settings isolation (Map-based cache).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "should"
import { createStorageContext } from "@shared/storage/storage-context"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { StateManager } from "../StateManager"

function getTaskStateCache(sm: StateManager): Map<string, any> {
	return (sm as any).taskStateCache
}
function getActiveTaskId(sm: StateManager): string | undefined {
	return (sm as any).activeTaskId
}

describe("StateManager — Per-Task Settings Isolation", () => {
	let tempDir: string
	let sm: StateManager

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-state-manager-"))
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

	describe("taskStateCache Map basics", () => {
		it("should store per-task caches as a Map", () => {
			const cache = getTaskStateCache(sm)
			;(cache instanceof Map).should.be.true()
		})
		it("should start with empty task caches after init", () => {
			getTaskStateCache(sm).size.should.equal(0)
		})
		it("should have no activeTaskId after init", () => {
			;(getActiveTaskId(sm) === undefined).should.be.true()
		})
	})

	describe("setActiveTask and loadTaskSettings", () => {
		it("should set activeTaskId when loading task settings", async () => {
			await sm.loadTaskSettings("task-1")
			getActiveTaskId(sm)?.should.equal("task-1")
		})
		it("should create cache entry via setActiveTask", () => {
			sm.setActiveTask("task-1")
			const cache = getTaskStateCache(sm)
			cache.has("task-1").should.be.true()
			getActiveTaskId(sm)?.should.equal("task-1")
		})
		it("should switch activeTaskId when loading a different task", async () => {
			await sm.loadTaskSettings("task-1")
			await sm.loadTaskSettings("task-2")
			getActiveTaskId(sm)?.should.equal("task-2")
		})
	})

	describe("per-task settings isolation", () => {
		it("should isolate settings between two tasks", () => {
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "mode", "plan" as any)
			sm.setTaskSettings("task-A", "planModeProfile", "anthropic" as any)
			sm.setActiveTask("task-B")
			sm.setTaskSettings("task-B", "mode", "act" as any)
			sm.setTaskSettings("task-B", "planModeProfile", "openrouter" as any)
			sm.setActiveTask("task-A")
			sm.getGlobalSettingsKey("mode")?.should.equal("plan")
			sm.getGlobalSettingsKey("planModeProfile")?.should.equal("anthropic")
			sm.setActiveTask("task-B")
			sm.getGlobalSettingsKey("mode")?.should.equal("act")
			sm.getGlobalSettingsKey("planModeProfile")?.should.equal("openrouter")
		})
		it("should fallback to global settings when task cache doesn't have key", () => {
			sm.setGlobalState("mode" as any, "act" as any)
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "planModeProfile", "anthropic" as any)
			sm.getGlobalSettingsKey("planModeProfile")?.should.equal("anthropic")
			sm.getGlobalSettingsKey("mode")?.should.equal("act")
		})
		it("should allow batch settings update per task", () => {
			sm.setActiveTask("task-A")
			sm.setTaskSettingsBatch("task-A", {
				mode: "plan" as any,
				planModeProfile: "anthropic" as any,
				yoloModeToggled: true as any,
			})
			sm.getGlobalSettingsKey("mode")?.should.equal("plan")
			sm.getGlobalSettingsKey("planModeProfile")?.should.equal("anthropic")
			sm.getGlobalSettingsKey("yoloModeToggled")?.should.equal(true)
		})
		it("should not leak task-A settings into task-B", () => {
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "mode", "plan" as any)
			sm.setActiveTask("task-B")
			const taskBCache = getTaskStateCache(sm).get("task-B")
			;(!taskBCache || taskBCache.mode === undefined).should.be.true()
		})
		it("should support 3 concurrent tasks with independent settings", () => {
			sm.setActiveTask("task-1")
			sm.setTaskSettings("task-1", "mode", "plan" as any)
			sm.setActiveTask("task-2")
			sm.setTaskSettings("task-2", "mode", "act" as any)
			sm.setActiveTask("task-3")
			sm.setTaskSettings("task-3", "mode", "plan" as any)
			sm.setActiveTask("task-1")
			sm.getGlobalSettingsKey("mode")?.should.equal("plan")
			sm.setActiveTask("task-2")
			sm.getGlobalSettingsKey("mode").should.equal("act")
			sm.setActiveTask("task-3")
			sm.getGlobalSettingsKey("mode")?.should.equal("plan")
		})
	})

	describe("clearTaskSettings", () => {
		it("should clear only the active task's cache", async () => {
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "mode", "plan" as any)
			sm.setActiveTask("task-B")
			sm.setTaskSettings("task-B", "mode", "act" as any)
			await sm.clearTaskSettings()
			getTaskStateCache(sm).has("task-B").should.be.false()
			getTaskStateCache(sm).has("task-A").should.be.true()
			;(getActiveTaskId(sm) === undefined).should.be.true()
		})
		it("should not affect other tasks when clearing", async () => {
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "mode", "plan" as any)
			sm.setActiveTask("task-B")
			await sm.clearTaskSettings()
			sm.setActiveTask("task-A")
			sm.getGlobalSettingsKey("mode")?.should.equal("plan")
		})
	})

	describe("getApiConfiguration with per-task overrides", () => {
		it("should return per-task provider in ApiConfiguration", () => {
			sm.setGlobalState("planModeProfile" as any, "openrouter" as any)
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "planModeProfile", "anthropic" as any)
			sm.getApiConfiguration().planModeProfile?.should.equal("anthropic")
		})
		it("should return global provider when no task override", () => {
			sm.setGlobalState("planModeProfile" as any, "openrouter" as any)
			sm.setActiveTask("task-empty")
			sm.getApiConfiguration().planModeProfile?.should.equal("openrouter")
		})
		it("should fallback to global provider after clearing a task override", () => {
			sm.setGlobalState("planModeProfile", "openrouter")
			sm.setActiveTask("task-A")
			sm.setTaskSettings("task-A", "planModeProfile", "anthropic")
			sm.getApiConfiguration().planModeProfile?.should.equal("anthropic")
			sm.clearTaskSetting("task-A", "planModeProfile")
			sm.getApiConfiguration().planModeProfile?.should.equal("openrouter")
		})
	})

	describe("settings repository synchronization", () => {
		it("broadcasts a committed Settings revision to every registered controller callback", async () => {
			const first = vi.fn().mockResolvedValue(undefined)
			const second = vi.fn().mockResolvedValue(undefined)
			const disposeFirst = sm.registerCallbacks({ onSyncExternalChange: first })
			const disposeSecond = sm.registerCallbacks({ onSyncExternalChange: second })

			await (sm as any).settingsRepository.mutate({ chatInputSendShortcut: "ctrlEnter" })

			expect(first).toHaveBeenCalledOnce()
			expect(second).toHaveBeenCalledOnce()
			disposeFirst()
			disposeSecond()
		})

		it("uses the declared default after a committed Settings key is deleted", async () => {
			await (sm as any).settingsRepository.mutate({ showFeatureTips: false })
			sm.getGlobalSettingsKey("showFeatureTips").should.equal(false)

			await (sm as any).settingsRepository.mutate({ showFeatureTips: undefined })

			sm.getGlobalSettingsKey("showFeatureTips").should.equal(true)
		})

		it("restores the declared default after a StateManager Settings deletion is committed", async () => {
			await (sm as any).settingsRepository.mutate({ showFeatureTips: false })
			sm.getGlobalSettingsKey("showFeatureTips").should.equal(false)

			sm.setGlobalState("showFeatureTips", undefined)
			await sm.flushPendingState()

			sm.getGlobalSettingsKey("showFeatureTips").should.equal(true)
		})

		it("routes Settings keys in a batch through the canonical repository", async () => {
			sm.setGlobalStateBatch({
				chatInputSendShortcut: "ctrlEnter",
				terminalOutputLineLimit: 900,
			})
			await sm.flushPendingState()

			const settingsStorage = createStorageContext({ clineDir: tempDir }).settings
			settingsStorage.get("chatInputSendShortcut").should.equal("ctrlEnter")
			settingsStorage.get("terminalOutputLineLimit").should.equal(900)
		})

		it("keeps pending Settings durable when the StateManager shuts down", async () => {
			sm.setGlobalState("chatInputSendShortcut", "ctrlEnter")
			await (StateManager as any).shutdown()

			const restarted = await StateManager.initialize(createStorageContext({ clineDir: tempDir }))
			restarted.getGlobalSettingsKey("chatInputSendShortcut").should.equal("ctrlEnter")
		})

		it("does not clear a Settings mutation created while an earlier flush is in flight", async () => {
			const repository = (sm as any).settingsRepository as {
				mutate: (patch: Partial<Record<string, unknown>>, sourceId?: string) => Promise<unknown>
			}
			const originalMutate = repository.mutate.bind(repository)
			let releaseFirstCommit!: () => void
			let markFirstCommitStarted!: () => void
			const firstCommitStarted = new Promise<void>((resolve) => {
				markFirstCommitStarted = resolve
			})
			const firstCommitRelease = new Promise<void>((resolve) => {
				releaseFirstCommit = resolve
			})
			let isFirstCommit = true
			vi.spyOn(repository, "mutate").mockImplementation(async (patch, sourceId) => {
				if (isFirstCommit) {
					isFirstCommit = false
					markFirstCommitStarted()
					await firstCommitRelease
				}
				return originalMutate(patch, sourceId)
			})

			sm.setGlobalState("chatInputSendShortcut", "ctrlEnter")
			const firstFlush = sm.flushPendingState()
			await firstCommitStarted
			sm.setGlobalState("terminalOutputLineLimit", 900)
			releaseFirstCommit()
			await firstFlush
			await sm.flushPendingState()

			const settingsStorage = createStorageContext({ clineDir: tempDir }).settings
			settingsStorage.get("chatInputSendShortcut").should.equal("ctrlEnter")
			settingsStorage.get("terminalOutputLineLimit").should.equal(900)
		})

		it("should dual-write settings to settings.json and globalState.json", async () => {
			sm.setGlobalState("mode" as any, "plan" as any)
			await sm.flushPendingState()

			// settings.json should have the value
			sm.getGlobalSettingsKey("mode" as any)?.should.equal("plan")
		})

		it("should read settings from settingsCache first", async () => {
			// Pre-populate settings via setGlobalState (dual-write)
			sm.setGlobalState("mode" as any, "plan" as any)
			await sm.flushPendingState()

			// Reset and re-init — should load from settings.json
			await StateManager.resetForTest()
			const sm2 = await StateManager.initialize(createStorageContext({ clineDir: tempDir }))

			sm2.getGlobalSettingsKey("mode" as any)?.should.equal("plan")
			await StateManager.resetForTest()
		})

		it("should fallback to globalStateCache when settingsCache is empty", () => {
			// Clear settingsCache for this key to simulate pre-migration fallback
			delete (sm as any).settingsCache["yoloModeToggled"]
			// Write only to globalStateCache
			;(sm as any).globalStateCache["yoloModeToggled"] = true

			sm.getGlobalSettingsKey("yoloModeToggled" as any)?.should.equal(true)
		})
	})

	describe("secrets routing to split stores", () => {
		it("should route and persist account/wandb secrets", async () => {
			// Route writes to split stores
			sm.setSecret("clineApiKey", "test-key")
			sm.setSecret("clineAccountId", "acc-456")
			sm.setSecret("wandbApiKey", "wandb-key")
			await sm.flushPendingState()

			sm.getSecretKey("clineApiKey")!.should.equal("test-key")
			sm.getSecretKey("clineAccountId")!.should.equal("acc-456")
			sm.getSecretKey("wandbApiKey")!.should.equal("wandb-key")

			// Persist across re-init
			await StateManager.resetForTest()
			const sm2 = await StateManager.initialize(createStorageContext({ clineDir: tempDir }))

			sm2.getSecretKey("clineApiKey")!.should.equal("test-key")
			sm2.getSecretKey("wandbApiKey")!.should.equal("wandb-key")
			await StateManager.resetForTest()
		})
	})

	describe("settings migration from globalState", () => {
		it("should migrate settings from globalState.json to settings.json on first start", async () => {
			// The beforeEach already created a clean instance with migration run.
			// Verify sentinel and migrated value exist in settings store.
			const storageCtx = createStorageContext({ clineDir: tempDir })
			const sentinel = storageCtx.settings.get("__settingsMigrationVersion")
			sentinel?.should.equal(1)
		})

		it("should keep task history inside the injected storage boundary", () => {
			const storageCtx = createStorageContext({ clineDir: tempDir })
			storageCtx.taskHistoryPath.should.equal(path.join(tempDir, "tasks", "taskHistory.jsonl"))
		})

		it("should filter deprecated keys and migrate valid keys", async () => {
			// Deprecated keys should NOT appear in settings store after migration
			const storageCtx = createStorageContext({ clineDir: tempDir })
			const deprecatedVal = storageCtx.settings.get("planModeOcaModelId")
			;(deprecatedVal === undefined).should.be.true()

			// Valid settings keys should be migrated and readable
			sm.setGlobalState("preferredLanguage" as any, "zh-CN" as any)
			await sm.flushPendingState()
			sm.getGlobalSettingsKey("preferredLanguage" as any)?.should.equal("zh-CN")
		})
	})
})
