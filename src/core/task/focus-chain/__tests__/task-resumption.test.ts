import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ensureTaskDirectoryExists } from "../../../storage/disk"
import { TaskState } from "../../TaskState"
import { createFocusChainMarkdownContent, getFocusChainFilePath } from "../file-utils"
import { FocusChainManager } from "../index"

describe("FocusChainManager - Task Resumption", () => {
	let taskId: string
	let taskDir: string
	let focusChainFilePath: string
	let tempDocumentsDir: string
	let manager: FocusChainManager | undefined

	beforeEach(async () => {
		tempDocumentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-focus-chain-resumption-"))
		vi.stubEnv("DLINE_DOCS_DIR", tempDocumentsDir)
		expect(process.env.DLINE_DOCS_DIR).toBe(tempDocumentsDir)

		taskId = `test-${Date.now()}`
		taskDir = await ensureTaskDirectoryExists(taskId)
		expect(path.relative(tempDocumentsDir, taskDir)).toBe(path.join("tasks", taskId))
		focusChainFilePath = getFocusChainFilePath(taskDir, taskId)
	})

	afterEach(async () => {
		manager?.dispose()
		manager = undefined
		vi.unstubAllEnvs()
		await fs.rm(tempDocumentsDir, { recursive: true, force: true })
		await expect(fs.access(tempDocumentsDir)).rejects.toMatchObject({ code: "ENOENT" })
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

		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
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
	})

	it("should create focus chain file for new tasks", async () => {
		// Arrange: Ensure file does NOT exist
		try {
			await fs.unlink(focusChainFilePath)
		} catch {
			// File already doesn't exist
		}

		const taskState = new TaskState()
		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
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

		// Assert: New tasks create an accessible empty file but do not seed example checklist content
		expect(taskState.currentFocusChainChecklist).toBeNull()
	})

	it.each([undefined, "", "  \n\t"])("treats an absent or blank task_progress value as a no-op: %j", async (taskProgress) => {
		const existingContent = `# Existing Task
- [ ] Pending item`
		const fileContent = createFocusChainMarkdownContent(taskId, existingContent)
		await fs.writeFile(focusChainFilePath, fileContent, "utf8")

		const taskState = new TaskState()
		const mockSay = vi.fn()
		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: mockSay,
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		await manager.updateFCListFromToolResponse(taskProgress)

		expect(taskState.currentFocusChainChecklist).toBeNull()
		expect(mockSay).not.toHaveBeenCalled()
	})

	it("ignores non-empty task_progress content without a valid TODO item", async () => {
		const taskState = new TaskState()
		const mockSay = vi.fn()
		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: mockSay,
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		await manager.updateFCListFromToolResponse("# Empty plan\n## Phase")

		expect(taskState.currentFocusChainChecklist).toBeNull()
		expect(mockSay).not.toHaveBeenCalled()
	})

	it("hydrates the persisted TODO list when the first valid update arrives before watcher setup", async () => {
		const existingContent = `# Resumed Task
- [x] Step 1
- [ ] Step 2`
		const fileContent = createFocusChainMarkdownContent(taskId, existingContent)
		await fs.writeFile(focusChainFilePath, fileContent, "utf8")

		const taskState = new TaskState()
		const mockSay = vi.fn()
		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
			stateManager: {} as any,
			postStateToWebview: vi.fn(),
			say: mockSay,
			focusChainSettings: { enabled: true, remindClineInterval: 10 },
		})

		await manager.updateFCListFromToolResponse("- [x] Step 2")

		expect(taskState.currentFocusChainChecklist).toContain("- [x] Step 2")
		expect(mockSay.mock.calls.filter((call) => call[0] === "error")).toEqual([])
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
		manager = new FocusChainManager({
			taskId,
			taskState,
			getMode: () => "act",
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
	})
})
