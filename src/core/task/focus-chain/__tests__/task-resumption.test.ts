import * as fs from "fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ensureTaskDirectoryExists } from "../../../storage/disk"
import { TaskState } from "../../TaskState"
import { createFocusChainMarkdownContent, getFocusChainFilePath } from "../file-utils"
import { FocusChainManager } from "../index"

describe("FocusChainManager - Task Resumption", () => {
	let taskId: string
	let taskDir: string
	let focusChainFilePath: string

	beforeEach(async () => {
		taskId = `test-${Date.now()}`
		taskDir = await ensureTaskDirectoryExists(taskId)
		focusChainFilePath = getFocusChainFilePath(taskDir, taskId)
	})

	it("should load existing checklist from disk on setupFocusChainFileWatcher", async () => {
		// Arrange: Create a focus chain file on disk with existing content
		const existingContent = `# Test Task
## Phase 1
- [x] Completed item
- [ ] Pending item`
		const fileContent = createFocusChainMarkdownContent(taskId, existingContent)
		await fs.writeFile(focusChainFilePath, fileContent, "utf8")

		// Create TaskState and FocusChainManager
		const taskState = new TaskState()
		expect(taskState.currentFocusChainChecklist).toBeNull() // Initially null

		const manager = new FocusChainManager({
			taskId,
			taskState,
			mode: "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: vi.fn(),
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		// Act: Setup watcher (which should now load existing checklist)
		await manager.setupFocusChainFileWatcher()

		// Assert: TaskState should now have the checklist loaded
		expect(taskState.currentFocusChainChecklist).not.toBeNull()
		expect(taskState.currentFocusChainChecklist).toContain("# Test Task")
		expect(taskState.currentFocusChainChecklist).toContain("- [x] Completed item")
		expect(taskState.currentFocusChainChecklist).toContain("- [ ] Pending item")

		// Cleanup
		await manager.dispose()
	})

	it("should create focus chain file for new tasks", async () => {
		// Arrange: Ensure file does NOT exist
		try {
			await fs.unlink(focusChainFilePath)
		} catch {
			// File already doesn't exist
		}

		const taskState = new TaskState()
		const manager = new FocusChainManager({
			taskId,
			taskState,
			mode: "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: vi.fn(),
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		// Act: Setup watcher (should create file with example content or empty)
		await manager.setupFocusChainFileWatcher()

		// Assert: File should now exist
		const fileExists = await fs
			.access(focusChainFilePath)
			.then(() => true)
			.catch(() => false)
		expect(fileExists).toBe(true)

		// Assert: TaskState loads whatever is in the file (example content in this case)
		// The key point is that the file exists and is accessible, preventing EPERM errors
		expect(taskState.currentFocusChainChecklist).not.toBeNull()

		// Cleanup
		await manager.dispose()
	})

	it("should prevent 'no task plan exists' error after resumption", async () => {
		// Arrange: Simulate a resumed task with existing focus chain
		const existingContent = `# Resumed Task
- [x] Step 1
- [ ] Step 2
- [ ] Step 3`
		const fileContent = createFocusChainMarkdownContent(taskId, existingContent)
		await fs.writeFile(focusChainFilePath, fileContent, "utf8")

		const taskState = new TaskState()
		const mockSay = vi.fn()
		const manager = new FocusChainManager({
			taskId,
			taskState,
			mode: "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: mockSay,
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		// Act: Setup watcher (loads checklist from disk)
		await manager.setupFocusChainFileWatcher()

		// Simulate AI reporting progress (this would previously fail with "no task plan exists")
		const taskProgress = "- [x] Step 2"
		await manager.updateFCListFromToolResponse(taskProgress)

		// Assert: Should NOT have called say() with error
		const errorCalls = mockSay.mock.calls.filter((call) => call[0] === "error")
		const noTaskPlanError = errorCalls.find((call) => call[1]?.includes("no task plan exists"))
		expect(noTaskPlanError).toBeUndefined()

		// Assert: TaskState should have updated checklist
		expect(taskState.currentFocusChainChecklist).toContain("- [x] Step 2")

		// Cleanup
		await manager.dispose()
	})
})
