import * as path from "path"
import { describe, expect, it } from "vitest"
import { TaskFileTracker } from "../TaskFileTracker"

describe("TaskFileTracker", () => {
	it("keeps lifetime edited files after checkpoint increment is cleared", () => {
		const tracker = new TaskFileTracker("task-1")
		const filePath = path.resolve("src/example.ts")

		tracker.trackModification(filePath)
		tracker.clearModifiedFiles()

		expect(tracker.getModifiedFiles()).toEqual([])
		expect(tracker.getAllModifiedFiles()).toEqual([filePath.toLowerCase()])
	})

	it("clears lifetime edited files on dispose", () => {
		const tracker = new TaskFileTracker("task-1")
		const filePath = path.resolve("src/example.ts")

		tracker.trackModification(filePath)
		tracker.dispose()

		expect(tracker.getModifiedFiles()).toEqual([])
		expect(tracker.getAllModifiedFiles()).toEqual([])
	})
})
