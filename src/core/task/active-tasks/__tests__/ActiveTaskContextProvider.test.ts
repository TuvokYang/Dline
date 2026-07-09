import { describe, expect, it } from "vitest"
import { buildActiveTasksSection } from "../ActiveTaskContextProvider"

interface TestTaskSource {
	taskId: string
	getActiveTaskSummary(): string
	getActiveTaskPhase(): string
	getActiveTaskEditedFiles(): string[]
}

interface TestControllerSource {
	task?: TestTaskSource
}

/**
 * Create a controller-like source for ActiveTaskContextProvider tests.
 * @param task Active task source exposed by the fake controller.
 * @returns Controller-like object consumed by the provider.
 */
function createController(task: TestTaskSource): TestControllerSource {
	return { task }
}

describe("ActiveTaskContextProvider", () => {
	it("returns empty text when there are no active tasks", () => {
		const section = buildActiveTasksSection({ controllers: [], currentCwd: "e:/workspace/vscode/dline" })

		expect(section).toBe("")
	})

	it("formats active tasks with id, 128-character summary, phase, and edited files", () => {
		const longSummary = "a".repeat(140)
		const section = buildActiveTasksSection({
			controllers: [
				createController({
					taskId: "task-1",
					getActiveTaskSummary: () => longSummary,
					getActiveTaskPhase: () => "awaiting_approval",
					getActiveTaskEditedFiles: () => ["e:/workspace/vscode/dline/src/core/task/index.ts"],
				}),
			],
			currentCwd: "e:/workspace/vscode/dline",
		})

		expect(section).toContain("# Active Tasks")
		expect(section).toContain("- id: task-1")
		expect(section).toContain(`summary: ${"a".repeat(127)}…`)
		expect(section).toContain("phase: awaiting_approval")
		expect(section).toContain("    - src/core/task/index.ts")
	})

	it("limits edited files per task", () => {
		const files = Array.from({ length: 52 }, (_value, index) => `e:/workspace/vscode/dline/src/file-${index}.ts`)
		const section = buildActiveTasksSection({
			controllers: [
				createController({
					taskId: "task-1",
					getActiveTaskSummary: () => "short task",
					getActiveTaskPhase: () => "streaming",
					getActiveTaskEditedFiles: () => files,
				}),
			],
			currentCwd: "e:/workspace/vscode/dline",
		})

		expect(section).toContain("    - src/file-49.ts")
		expect(section).toContain("    - ... 2 more")
		expect(section).not.toContain("src/file-50.ts")
	})
})
