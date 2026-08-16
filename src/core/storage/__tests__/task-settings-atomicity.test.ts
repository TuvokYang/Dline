import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readTaskSettingsFromStorage, writeTaskSettingsToStorage } from "../disk"

describe("Task settings atomic persistence", () => {
	let originalDocsDir: string | undefined
	let temporaryDirectory: string

	beforeEach(async () => {
		originalDocsDir = process.env.DLINE_DOCS_DIR
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dline-task-settings-atomicity-"))
		process.env.DLINE_DOCS_DIR = temporaryDirectory
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		if (originalDocsDir === undefined) delete process.env.DLINE_DOCS_DIR
		else process.env.DLINE_DOCS_DIR = originalDocsDir
		await fs.rm(temporaryDirectory, { recursive: true, force: true })
	})

	it("keeps the committed Task settings readable while the next write is in progress", async () => {
		const taskId = "atomic-task-settings"
		await writeTaskSettingsToStorage(taskId, {
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "low",
		})

		const settingsPath = path.join(temporaryDirectory, "tasks", taskId, "settings.json")
		const originalWriteFile = fs.writeFile.bind(fs)
		let releaseWrite: (() => void) | undefined
		const writePaused = new Promise<void>((resolve) => {
			releaseWrite = resolve
		})
		let observedWrite: (() => void) | undefined
		const writeObserved = new Promise<void>((resolve) => {
			observedWrite = resolve
		})

		vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
			await originalWriteFile(file, data, options)
			if (String(file).startsWith(settingsPath)) {
				observedWrite?.()
				await writePaused
			}
		})

		const update = writeTaskSettingsToStorage(taskId, {
			actModeReasoningOverrideEffort: "medium",
		})
		await writeObserved

		await expect(readTaskSettingsFromStorage(taskId)).resolves.toMatchObject({
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "low",
		})

		releaseWrite?.()
		await update
		await expect(readTaskSettingsFromStorage(taskId)).resolves.toMatchObject({
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "medium",
		})
	})
})
