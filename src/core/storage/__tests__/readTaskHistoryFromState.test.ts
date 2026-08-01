import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { reconstructTaskHistory } = vi.hoisted(() => ({
	reconstructTaskHistory: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/core/commands/reconstructTaskHistory", () => ({ reconstructTaskHistory }))

import { readTaskHistoryFromState } from "../disk"

describe("readTaskHistoryFromState", () => {
	let originalDlineDocsDir: string | undefined
	let testDir: string

	beforeEach(async () => {
		originalDlineDocsDir = process.env.DLINE_DOCS_DIR
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-task-history-read-"))
		process.env.DLINE_DOCS_DIR = testDir
		reconstructTaskHistory.mockClear()
	})

	afterEach(async () => {
		if (originalDlineDocsDir === undefined) {
			delete process.env.DLINE_DOCS_DIR
		} else {
			process.env.DLINE_DOCS_DIR = originalDlineDocsDir
		}
		await fs.rm(testDir, { recursive: true, force: true })
	})

	it("returns an empty history without starting reconstruction when no history file exists", async () => {
		await expect(readTaskHistoryFromState()).resolves.toEqual([])
		expect(reconstructTaskHistory).not.toHaveBeenCalled()
	})
})
