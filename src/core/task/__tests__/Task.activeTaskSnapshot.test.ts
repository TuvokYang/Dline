import { describe, expect, it } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"
import { Task } from "../index"

describe("Task active task snapshot accessors", () => {
	it("returns buildTurn phase from the first non-completed block", () => {
		const fakeTask = {
			taskController: {
				getBlocks: () => [
					{ callId: "done", toolName: "read_file", phase: BlockPhase.COMPLETED },
					{ callId: "active", toolName: "write_to_file", phase: BlockPhase.AWAITING_APPROVAL },
				],
			},
		} as unknown as Task

		expect(Task.prototype.getActiveTaskPhase.call(fakeTask)).toBe(BlockPhase.AWAITING_APPROVAL)
	})

	it("returns completed when all buildTurn blocks are completed", () => {
		const fakeTask = {
			taskController: {
				getBlocks: () => [{ callId: "done", toolName: "read_file", phase: BlockPhase.COMPLETED }],
			},
		} as unknown as Task

		expect(Task.prototype.getActiveTaskPhase.call(fakeTask)).toBe(BlockPhase.COMPLETED)
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
