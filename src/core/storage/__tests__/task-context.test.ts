import type { TaskContextCache } from "@core/storage/task-context-types"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GlobalFileNames, getTaskContext, saveTaskContext } from "../disk"

let testDir: string
let previousDocsDir: string | undefined

beforeEach(async () => {
	previousDocsDir = process.env.DLINE_DOCS_DIR
	testDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-task-context-"))
	process.env.DLINE_DOCS_DIR = testDir
})

afterEach(async () => {
	if (previousDocsDir === undefined) {
		delete process.env.DLINE_DOCS_DIR
	} else {
		process.env.DLINE_DOCS_DIR = previousDocsDir
	}
	await fs.rm(testDir, { recursive: true, force: true })
})

/**
 * Build a complete task context cache fixture.
 *
 * @param taskId Task identifier for the fixture.
 * @returns Task context cache fixture with a frozen prompt.
 */
function buildContext(taskId: string): TaskContextCache {
	return {
		schemaVersion: 1,
		taskId,
		createdAt: 100,
		updatedAt: 200,
		systemPrompt: {
			frozen: {
				text: "frozen prompt\n\n# Capabilities",
				tools: [{ type: "function", function: { name: "frozen_tool" } }],
				capabilitiesHash: "sha256:test",
				createdAt: 100,
				refreshedAt: 200,
				refreshReason: "task_start",
				promptBuilder: {
					providerId: "test-provider",
					modelId: "test-model",
					profile: "native",
					nativeTools: false,
				},
			},
		},
	}
}

describe("task context cache", () => {
	it("returns an empty versioned context when context.json does not exist", async () => {
		const context = await getTaskContext("task-1")

		expect(context.schemaVersion).toBe(1)
		expect(context.taskId).toBe("task-1")
		expect(context.systemPrompt).toBeUndefined()
	})

	it("persists and reads frozen system prompt cache from context.json", async () => {
		const taskId = "task-2"
		const expected = buildContext(taskId)

		await saveTaskContext(taskId, expected)
		const actual = await getTaskContext(taskId)

		expect(actual).toEqual(expected)
		expect(actual.systemPrompt?.frozen?.tools).toEqual(expected.systemPrompt?.frozen?.tools)
		const filePath = path.join(testDir, "tasks", taskId, GlobalFileNames.taskContext)
		expect(await fs.readFile(filePath, "utf8")).toContain("# Capabilities")
	})

	it.each([
		["string", "not-an-array"],
		["empty-object", [{}]],
		["null-entry", [null]],
	] as const)("rejects malformed frozen provider tools: %s", async (caseId, tools) => {
		const taskId = `task-malformed-tools-${caseId}`
		const filePath = path.join(testDir, "tasks", taskId, GlobalFileNames.taskContext)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		const malformed = buildContext(taskId)
		await fs.writeFile(
			filePath,
			JSON.stringify({
				...malformed,
				systemPrompt: { frozen: { ...malformed.systemPrompt?.frozen, tools } },
			}),
			"utf8",
		)

		const actual = await getTaskContext(taskId)

		expect(actual.systemPrompt).toBeUndefined()
	})

	it("falls back to an empty context when context.json is invalid", async () => {
		const taskId = "task-3"
		const filePath = path.join(testDir, "tasks", taskId, GlobalFileNames.taskContext)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, "{ invalid json", "utf8")

		const context = await getTaskContext(taskId)

		expect(context.schemaVersion).toBe(1)
		expect(context.taskId).toBe(taskId)
		expect(context.systemPrompt).toBeUndefined()
	})
})
