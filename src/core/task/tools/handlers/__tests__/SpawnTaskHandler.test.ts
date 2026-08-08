/**
 * Unit tests for SpawnTaskHandler — covers all execution paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import "should"
import { ClineDefaultTool } from "@/shared/tools"
import { SpawnTaskHandler } from "../SpawnTaskHandler"

const spawnMocks = vi.hoisted(() => ({
	createPanel: vi.fn(async () => undefined),
	disposePanel: vi.fn(async () => undefined),
	initTask: vi.fn(),
	clearTask: vi.fn(async () => undefined),
	disposeController: vi.fn(async () => undefined),
	recordSpawn: vi.fn(),
	spawnTask: vi.fn(),
}))

vi.mock("@/hosts/vscode/VscodeWebviewPanelProvider", () => ({
	VscodeWebviewPanelProvider: class {
		readonly controller = {
			initTask: spawnMocks.initTask,
			clearTask: spawnMocks.clearTask,
			dispose: spawnMocks.disposeController,
		}

		createPanel = spawnMocks.createPanel
		dispose = spawnMocks.disposePanel
	},
}))

vi.mock("@/core/orchestrator/OrchestratorController", () => ({
	OrchestratorController: {
		getInstance: () => ({
			recordSpawn: spawnMocks.recordSpawn,
			spawnTask: spawnMocks.spawnTask,
		}),
	},
}))

describe("SpawnTaskHandler", () => {
	const handler = new SpawnTaskHandler()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("basic properties", () => {
		it("should have name SPAWN_TASK", () => {
			handler.name.should.equal(ClineDefaultTool.SPAWN_TASK)
		})

		it("should return description with spawn_task tag", () => {
			const desc = handler.getDescription({ name: "spawn_task" } as any)
			desc.should.match(/\[spawn_task\]/)
		})
	})

	describe("execute — missing task parameter", () => {
		it("should call sayAndCreateMissingParamError when task is missing", async () => {
			let called = false
			const config = {
				taskId: "parent-1",
				taskState: { consecutiveMistakeCount: 0 },
				callbacks: {
					sayAndCreateMissingParamError: async (_toolName: string, _param: string) => {
						called = true
						return "Missing param error"
					},
					ask: async () => ({ response: "no" }),
					say: async () => {},
				},
				services: { stateManager: {} },
			} as any

			await handler.execute(config, { name: "spawn_task", params: {} } as any)
			called.should.be.true()
			config.taskState.consecutiveMistakeCount.should.equal(1)
		})
	})

	describe("execute — task param provided", () => {
		it("should reset mistake count when task is provided", async () => {
			const config = {
				taskId: "parent-1",
				taskState: { consecutiveMistakeCount: 5 },
				taskController: { rejectActiveBlock: () => {} },
				interactions: {
					open: async () => ({ actionId: "reject" }),
				},
				callbacks: {
					ask: async () => ({ response: "noButtonClicked" }),
					say: async () => {},
				},
				services: { stateManager: {} },
			} as any

			await handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-reset",
				params: { task: "Test task" },
			} as any)
			config.taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	describe("execute — user denies spawn", () => {
		it("should return toolDenied when user clicks no", async () => {
			const config = {
				taskId: "parent-1",
				taskState: { consecutiveMistakeCount: 0 },
				taskController: { rejectActiveBlock: () => {} },
				interactions: {
					open: async () => ({ actionId: "reject" }),
				},
				callbacks: {
					ask: async () => ({
						response: "noButtonClicked",
						text: undefined,
						images: undefined,
					}),
					say: async () => {},
				},
				services: { stateManager: {} },
			} as any

			const result = await handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-deny",
				params: { task: "Test task" },
			} as any)

			result.should.match(/denied|not approved/i)
		})

		it("should return feedback when user provided text instead of approving", async () => {
			const config = {
				taskId: "parent-1",
				taskState: { consecutiveMistakeCount: 0 },
				taskController: { rejectActiveBlock: () => {} },
				interactions: {
					open: async () => ({
						actionId: "reject",
						draft: { text: "I want to modify the task first", images: [], files: [] },
					}),
				},
				callbacks: {
					ask: async () => ({
						response: "text",
						text: "I want to modify the task first",
						images: undefined,
					}),
					say: async () => {},
				},
				services: { stateManager: {} },
			} as any

			const result = await handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-feedback",
				params: { task: "Test task", context: "some context" },
			} as any)

			result.should.match(/feedback/)
		})
	})

	describe("execute — approved spawn", () => {
		it("returns after background admission without waiting for the child task loop", async () => {
			const neverCompletes = new Promise<void>(() => undefined)
			spawnMocks.initTask.mockImplementation(async (...args: unknown[]) => {
				const options = args[5] as
					| {
							startInBackground?: boolean
							beforeStart?: (taskId: string) => Promise<void> | void
					  }
					| undefined
				if (options?.startInBackground !== true) {
					await neverCompletes
				}
				await options?.beforeStart?.("child-1")
				return "child-1"
			})
			const config = {
				taskId: "parent-1",
				mode: "plan",
				taskState: { consecutiveMistakeCount: 0, abort: false },
				interactions: { open: async () => ({ actionId: "approve" }) },
				callbacks: { say: async () => {} },
				services: {
					stateManager: {
						getApiConfiguration: () => ({ planModeProfile: "parent-profile" }),
						getApiConfigurationForTask: () => ({ planModeProfile: "parent-profile" }),
						getGlobalSettingsKey: () => "plan",
					},
				},
				controllerContext: {},
			} as any

			const execution = handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-background",
				params: { task: "Background child", context: "Context" },
			} as any)
			const result = await Promise.race([
				execution,
				new Promise<string>((resolve) => setTimeout(() => resolve("SPAWN_BLOCKED"), 25)),
			])

			expect(result).not.toBe("SPAWN_BLOCKED")
			expect(result).toContain("child-1")
			expect(spawnMocks.recordSpawn).toHaveBeenCalledWith("parent-1", "child-1")
		})

		it("disposes the new panel when child initialization fails", async () => {
			spawnMocks.initTask.mockRejectedValueOnce(new Error("init failed"))
			const config = {
				taskId: "parent-1",
				mode: "plan",
				taskState: { consecutiveMistakeCount: 0, abort: false },
				interactions: { open: async () => ({ actionId: "approve" }) },
				callbacks: { say: async () => {} },
				services: {
					stateManager: {
						getApiConfiguration: () => ({ planModeProfile: "parent-profile" }),
						getApiConfigurationForTask: () => ({ planModeProfile: "parent-profile" }),
						getGlobalSettingsKey: () => "plan",
					},
				},
				controllerContext: {},
			} as any

			const result = await handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-init-error",
				params: { task: "Failing child" },
			} as any)

			expect(result).toMatch(/init failed/i)
			expect(spawnMocks.disposePanel).toHaveBeenCalledOnce()
		})
	})

	describe("execute — error handling", () => {
		it("should return toolError when an exception occurs", async () => {
			const config = {
				taskId: "parent-1",
				taskState: { consecutiveMistakeCount: 0 },
				interactions: {
					open: async () => ({ actionId: "approve" }),
				},
				callbacks: {
					ask: async () => ({ response: "yesButtonClicked" }),
					say: async () => {},
				},
				services: { stateManager: {} },
				controllerContext: undefined,
			} as any

			const result = await handler.execute(config, {
				name: "spawn_task",
				dline_tid: "tid-error",
				params: { task: "Test task" },
			} as any)

			result.should.match(/spawn task failed/i)
		})
	})
})
