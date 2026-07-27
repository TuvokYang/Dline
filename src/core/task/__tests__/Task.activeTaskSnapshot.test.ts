import { describe, expect, it } from "vitest"
import { Task } from "../index"
import { TaskPhase } from "../TaskPhase"

describe("Task active task snapshot accessors", () => {
	it("returns the canonical runtime phase instead of the retained controller phase", () => {
		const fakeTask = {
			taskRuntime: { getState: () => ({ phase: TaskPhase.AWAITING_APPROVAL }) },
			taskController: {
				getBlocks: () => [{ phase: "completed" }],
			},
		} as unknown as Task

		expect(Task.prototype.getActiveTaskPhase.call(fakeTask)).toBe(TaskPhase.AWAITING_APPROVAL)
	})

	it("returns between-turns from the runtime after a turn finishes", () => {
		const fakeTask = {
			taskRuntime: { getState: () => ({ phase: TaskPhase.BETWEEN_TURNS }) },
		} as unknown as Task

		expect(Task.prototype.getActiveTaskPhase.call(fakeTask)).toBe(TaskPhase.BETWEEN_TURNS)
	})

	it("returns edited files from lifetime tracker", () => {
		const fakeTask = {
			taskFileTracker: {
				getAllModifiedFiles: () => ["e:/workspace/vscode/dline/src/a.ts"],
			},
		} as unknown as Task

		expect(Task.prototype.getActiveTaskEditedFiles.call(fakeTask)).toEqual(["e:/workspace/vscode/dline/src/a.ts"])
	})
})
