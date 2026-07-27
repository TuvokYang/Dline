/**
 * Unit tests for SpawnTaskHandler — covers all execution paths.
 */
import { describe, it } from "vitest"
import "should"
import { ClineDefaultTool } from "@/shared/tools"
import { SpawnTaskHandler } from "../SpawnTaskHandler"

describe("SpawnTaskHandler", () => {
	const handler = new SpawnTaskHandler()

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
