import { strict as assert } from "node:assert"
import { beforeEach, describe, it } from "vitest"
import { advanceLifecycle, getDeferredToolAction, type PartialToolLifecycle } from "../core/task/partial-tool-lifecycle"
import { TaskState } from "../core/task/TaskState"

describe("getDeferredToolAction", () => {
	it("undefined lifecycle => skip", () => {
		assert.equal(getDeferredToolAction(undefined, false, true), "skip")
	})

	it("complete-running => skip", () => {
		assert.equal(getDeferredToolAction("complete-running", false, true), "skip")
	})

	it("complete-done => skip", () => {
		assert.equal(getDeferredToolAction("complete-done", false, true), "skip")
	})

	it("partial-shown + non-turn-ending => execute", () => {
		assert.equal(getDeferredToolAction("partial-shown", false, false), "execute")
		assert.equal(getDeferredToolAction("partial-shown", false, true), "execute")
	})

	it("partial-shown + turn-ending + stream not complete => defer", () => {
		assert.equal(getDeferredToolAction("partial-shown", true, false), "defer")
	})

	it("partial-shown + turn-ending + stream complete => execute", () => {
		assert.equal(getDeferredToolAction("partial-shown", true, true), "execute")
	})
})

describe("advanceLifecycle", () => {
	let map: Map<number, PartialToolLifecycle>
	const ts = 42

	beforeEach(() => {
		map = new Map()
	})

	it("start-execute: partial-shown => complete-running", () => {
		map.set(ts, "partial-shown")
		advanceLifecycle(map, ts, "start-execute")
		assert.equal(map.get(ts), "complete-running")
	})

	it("start-execute: wrong state => no-op", () => {
		map.set(ts, "complete-running")
		advanceLifecycle(map, ts, "start-execute")
		assert.equal(map.get(ts), "complete-running")
	})

	it("start-execute: unknown ts => no-op", () => {
		advanceLifecycle(map, ts, "start-execute")
		assert.equal(map.get(ts), undefined)
	})

	it("execution-success: complete-running => complete-done", () => {
		map.set(ts, "complete-running")
		advanceLifecycle(map, ts, "execution-success")
		assert.equal(map.get(ts), "complete-done")
	})

	it("execution-success: wrong state => no-op", () => {
		map.set(ts, "partial-shown")
		advanceLifecycle(map, ts, "execution-success")
		assert.equal(map.get(ts), "partial-shown")
	})

	it("execution-failed: complete-running => partial-shown", () => {
		map.set(ts, "complete-running")
		advanceLifecycle(map, ts, "execution-failed")
		assert.equal(map.get(ts), "partial-shown")
	})

	it("execution-failed: wrong state => no-op", () => {
		map.set(ts, "complete-done")
		advanceLifecycle(map, ts, "execution-failed")
		assert.equal(map.get(ts), "complete-done")
	})

	it("full lifecycle: partial-shown -> complete-done, then skip", () => {
		map.set(ts, "partial-shown")
		const action1 = getDeferredToolAction("partial-shown", false, true)
		assert.equal(action1, "execute")
		advanceLifecycle(map, ts, "start-execute")
		assert.equal(map.get(ts), "complete-running")

		advanceLifecycle(map, ts, "execution-success")
		assert.equal(map.get(ts), "complete-done")

		const action2 = getDeferredToolAction("complete-done", false, true)
		assert.equal(action2, "skip")
	})

	it("full lifecycle: execute throw -> partial-shown, then retry", () => {
		map.set(ts, "partial-shown")
		advanceLifecycle(map, ts, "start-execute")
		assert.equal(map.get(ts), "complete-running")

		advanceLifecycle(map, ts, "execution-failed")
		assert.equal(map.get(ts), "partial-shown")

		const action = getDeferredToolAction("partial-shown", false, true)
		assert.equal(action, "execute")
	})
})

describe("TaskState integration", () => {
	it("partialToolLifecycleByTs uses PartialToolLifecycle type and clear works", () => {
		const state = new TaskState()
		assert.equal(state.partialToolLifecycleByTs.size, 0)

		state.partialToolLifecycleByTs.set(1, "partial-shown")
		state.partialToolLifecycleByTs.set(2, "complete-done")
		assert.equal(state.partialToolLifecycleByTs.size, 2)

		state.partialToolLifecycleByTs.clear()
		assert.equal(state.partialToolLifecycleByTs.size, 0)
	})

	it("complete-done persists after execution (presentAssistantMessage would see it)", () => {
		const state = new TaskState()
		const ts = 42
		// Simulate reRenderUpdatedPartialBlocks deferred execution
		state.partialToolLifecycleByTs.set(ts, "partial-shown")
		advanceLifecycle(state.partialToolLifecycleByTs, ts, "start-execute")
		advanceLifecycle(state.partialToolLifecycleByTs, ts, "execution-success")
		// After execution, lifecycle is complete-done
		// presentAssistantMessage switch would encounter this state
		assert.equal(
			state.partialToolLifecycleByTs.get(ts),
			"complete-done",
			"complete-done must be visible to presentAssistantMessage for skip guard",
		)
	})

	it("concurrent tools: mixed lifecycle states", () => {
		const state = new TaskState()
		const tsDone = 10
		const tsPending = 20
		state.partialToolLifecycleByTs.set(tsDone, "partial-shown")
		state.partialToolLifecycleByTs.set(tsPending, "partial-shown")
		// Execute tool 1
		advanceLifecycle(state.partialToolLifecycleByTs, tsDone, "start-execute")
		advanceLifecycle(state.partialToolLifecycleByTs, tsDone, "execution-success")
		// Tool 1: complete-done, Tool 2: still partial-shown
		assert.equal(state.partialToolLifecycleByTs.get(tsDone), "complete-done")
		assert.equal(state.partialToolLifecycleByTs.get(tsPending), "partial-shown")
		// deferred path: tool 1 skipped, tool 2 executed
		assert.equal(getDeferredToolAction(state.partialToolLifecycleByTs.get(tsDone), false, true), "skip")
		assert.equal(getDeferredToolAction(state.partialToolLifecycleByTs.get(tsPending), false, true), "execute")
	})

	it("stream reset: clear lifecycle map", () => {
		const state = new TaskState()
		state.partialToolLifecycleByTs.set(1, "partial-shown")
		state.partialToolLifecycleByTs.set(2, "complete-done")
		state.partialToolLifecycleByTs.set(3, "complete-running")
		assert.equal(state.partialToolLifecycleByTs.size, 3)
		// Simulate stream reset (index.ts line 3932)
		state.partialToolLifecycleByTs.clear()
		assert.equal(state.partialToolLifecycleByTs.size, 0)
	})
})
