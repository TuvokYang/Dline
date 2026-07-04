import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as should from "should"
// sinon import removed
import { createClineAPI } from "@/exports"
import { Logger } from "@/shared/services/Logger"
import type { ClineAPI } from "../exports/cline"
import { setVscodeHostProviderMock } from "./host-provider-test-utils"

describe("ClineAPI Core Functionality", () => {
	let api: ClineAPI
	let mockController: any
	let mockLoggerError: any /* sinon.SinonStub → vitest */
	let sandbox: any /* sinon.SinonSandbox → vitest */
	let _getGlobalStateStub: any /* sinon.SinonStub → vitest */

	beforeEach(async () => {
		sandbox = { mockRestore: () => {} }

		// Stub Logger.error
		mockLoggerError = vi.spyOn(Logger, "error")
		setVscodeHostProviderMock({})

		// Create a mock controller that matches what the real createClineAPI expects
		// We don't import the real Controller to avoid the webview dependencies
		mockController = {
			id: "test-controller-id",
			context: {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
					keys: vi.fn().mockReturnValue([]),
					setKeysForSync: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
					onDidChange: vi.fn(),
				},
			},
			updateCustomInstructions: vi.fn().mockResolvedValue(undefined),
			clearTask: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			initTask: vi.fn().mockResolvedValue(undefined),
			task: undefined,
		}

		// Create API instance
		api = createClineAPI(mockController)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("startNewTask", () => {
		it("should clear existing task and start new one with description", async () => {
			const taskDescription = "Create a test function"
			const images = ["image1.png", "image2.png"]

			await api.startNewTask(taskDescription, images)

			// Verify task clearing sequence
			expect(mockController.clearTask).toHaveBeenCalled()
			expect(mockController.postStateToWebview).toHaveBeenCalled()
			expect(mockController.initTask).toHaveBeenCalledWith(taskDescription, images)
		})

		it("should handle undefined task description", async () => {
			await api.startNewTask(undefined, [])

			expect(mockController.clearTask).toHaveBeenCalled()
			expect(mockController.initTask).toHaveBeenCalledWith(undefined, [])
		})

		it("should handle task with no images", async () => {
			await api.startNewTask("Task without images")

			expect(mockController.initTask).toHaveBeenCalledWith("Task without images", undefined)
		})
	})

	describe("sendMessage", () => {
		it("should send message to active task", async () => {
			const mockTask = {
				handleWebviewAskResponse: vi.fn().mockResolvedValue(undefined),
			}
			mockController.task = mockTask

			await api.sendMessage("Test message", ["image.png"])

			expect(mockTask.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "Test message", ["image.png"])
		})

		it("should handle no active task gracefully", async () => {
			mockController.task = undefined

			await api.sendMessage("Message to nowhere", [])
		})

		it("should handle empty message", async () => {
			const mockTask = {
				handleWebviewAskResponse: vi.fn().mockResolvedValue(undefined),
			}
			mockController.task = mockTask

			await api.sendMessage("", [])

			expect(mockTask.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "", [])
		})

		it("should handle undefined message", async () => {
			const mockTask = {
				handleWebviewAskResponse: vi.fn().mockResolvedValue(undefined),
			}
			mockController.task = mockTask

			await api.sendMessage(undefined, [])

			expect(mockTask.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "", [])
		})
	})

	describe("Button Press Methods", () => {
		describe("pressPrimaryButton", () => {
			it("should handle primary button press with active task", async () => {
				const mockTask = {
					handleWebviewAskResponse: vi.fn().mockResolvedValue(undefined),
				}
				mockController.task = mockTask

				await api.pressPrimaryButton()

				expect(mockTask.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked", "", [])
			})

			it("should handle primary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressPrimaryButton()

				expect(mockLoggerError).toHaveBeenCalledWith("No active task to press button for")
			})
		})

		describe("pressSecondaryButton", () => {
			it("should handle secondary button press with active task", async () => {
				const mockTask = {
					handleWebviewAskResponse: vi.fn().mockResolvedValue(undefined),
				}
				mockController.task = mockTask

				await api.pressSecondaryButton()

				expect(mockTask.handleWebviewAskResponse).toHaveBeenCalledWith("noButtonClicked", "", [])
			})

			it("should handle secondary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressSecondaryButton()

				expect(mockLoggerError).toHaveBeenCalledWith("No active task to press button for")
			})
		})
	})

	describe("Error Handling", () => {
		it("should handle errors in task initialization", async () => {
			mockController.initTask.mockRejectedValue(new Error("Init failed"))

			try {
				await api.startNewTask("test task")
				should.fail("", "", "Should have thrown an error", "")
			} catch (error: any) {
				error.message.should.equal("Init failed")
			}
		})
	})
})
