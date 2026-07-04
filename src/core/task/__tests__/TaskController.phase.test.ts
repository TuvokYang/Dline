import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import type { MessageChannel } from "../MessageChannel"
import { TaskController } from "../TaskController"
import { TaskPhase } from "../TaskPhase"
import { isValidApiIndex } from "../TaskSnapshot"

const mockChannel: MessageChannel = {
	say: vi.fn(),
	ask: vi.fn(),
	resolve: vi.fn(),
} as unknown as MessageChannel

describe("TaskController — phase state machine", () => {
	it("starts in IDLE phase", () => {
		const tc = new TaskController(mockChannel)
		assert.equal(tc.phase, TaskPhase.IDLE)
	})

	it("transitions from IDLE to INITIALIZING and persists snapshot", () => {
		const tc = new TaskController(mockChannel)
		const snapshots: any[] = []
		const snap = tc.transition(TaskPhase.INITIALIZING, {
			apiIndex: 0,
			onSnapshot: (s) => snapshots.push(s),
		})
		assert.equal(tc.phase, TaskPhase.INITIALIZING)
		assert.equal(snapshots.length, 1)
		assert.equal(snapshots[0].phase, TaskPhase.INITIALIZING)
		assert.equal(snap.phase, TaskPhase.INITIALIZING)
	})

	it("transitions through full lifecycle: IDLE → STREAMING → EXECUTING → BETWEEN_TURNS", () => {
		const tc = new TaskController(mockChannel)
		tc.transition(TaskPhase.STREAMING, { apiIndex: 0 })
		assert.equal(tc.phase, TaskPhase.STREAMING)

		tc.transition(TaskPhase.EXECUTING, {
			apiIndex: 1,
			execution: { mode: "parallel", executing: ["c1", "c2"] },
		})
		assert.equal(tc.phase, TaskPhase.EXECUTING)

		tc.transition(TaskPhase.BETWEEN_TURNS, { apiIndex: 2 })
		assert.equal(tc.phase, TaskPhase.BETWEEN_TURNS)
	})

	it("transitions to CANCELLING with cancel context", () => {
		const tc = new TaskController(mockChannel)
		tc.transition(TaskPhase.STREAMING, { apiIndex: 0 })
		const snap = tc.transition(TaskPhase.CANCELLING, {
			apiIndex: 0,
			cancel: { source: "user", fromPhase: TaskPhase.STREAMING },
		})
		assert.equal(tc.phase, TaskPhase.CANCELLING)
		assert.equal(snap.cancel?.source, "user")
	})

	it("snapshot() includes phase, apiIndex, and timestamp", () => {
		const tc = new TaskController(mockChannel)
		tc.transition(TaskPhase.EXECUTING, { apiIndex: 5 })
		const snap = tc.snapshot(5)
		assert.equal(snap.phase, TaskPhase.EXECUTING)
		assert.equal(snap.apiIndex, 5)
		assert.ok(typeof snap.timestamp === "number")
	})

	it("restoreFrom() sets phase from snapshot without triggering onSnapshot", () => {
		const tc = new TaskController(mockChannel)
		tc.restoreFrom({ phase: TaskPhase.EXECUTING, apiIndex: 3, timestamp: 1000 })
		assert.equal(tc.phase, TaskPhase.EXECUTING)
	})

	it("transition generates snapshot with approval context", () => {
		const tc = new TaskController(mockChannel)
		const snap = tc.transition(TaskPhase.AWAITING_APPROVAL, {
			apiIndex: 2,
			approval: {
				mode: "serial",
				blocks: [{ callId: "c1", name: "write_to_file", phase: "awaiting_approval" as any, apiIndex: 2 }],
				activeCallId: "c1",
			},
		})
		assert.equal(snap.approval?.mode, "serial")
		assert.equal(snap.approval?.activeCallId, "c1")
	})

	it("transition generates snapshot with resume context", () => {
		const tc = new TaskController(mockChannel)
		const snap = tc.transition(TaskPhase.RESUMING, {
			apiIndex: 3,
			resume: {
				assistantApiIndex: 1,
				pendingToolUseIds: ["t1", "t2"],
				answeredToolUseIds: ["t3"],
			},
		})
		assert.equal(snap.resume?.assistantApiIndex, 1)
		assert.deepEqual(snap.resume?.pendingToolUseIds, ["t1", "t2"])
	})

	it("transitions to PAUSED before CANCELLING", () => {
		const tc = new TaskController(mockChannel)
		tc.transition(TaskPhase.STREAMING, { apiIndex: 0 })

		const pausedSnap = tc.transition(TaskPhase.PAUSED, { apiIndex: 1 })
		assert.equal(tc.phase, TaskPhase.PAUSED)
		assert.equal(pausedSnap.phase, TaskPhase.PAUSED)

		const cancelSnap = tc.transition(TaskPhase.CANCELLING, {
			apiIndex: 1,
			cancel: { source: "user", fromPhase: TaskPhase.PAUSED },
		})
		assert.equal(tc.phase, TaskPhase.CANCELLING)
		assert.equal(cancelSnap.cancel?.fromPhase, TaskPhase.PAUSED)
	})

	it("onSnapshot callback receives correct phase and apiIndex on transition", () => {
		const tc = new TaskController(mockChannel)
		const captured: any[] = []

		tc.transition(TaskPhase.STREAMING, {
			apiIndex: 7,
			onSnapshot: (s) => captured.push(s),
		})

		assert.equal(captured.length, 1)
		assert.equal(captured[0].phase, TaskPhase.STREAMING)
		assert.equal(captured[0].apiIndex, 7)
		assert.ok(typeof captured[0].timestamp === "number")
	})

	it("apiIndex updates correctly across multiple transitions (not stuck at -1)", () => {
		const tc = new TaskController(mockChannel)

		// Simulate: history empty at start → apiIndex = -1
		const snap1 = tc.transition(TaskPhase.STREAMING, { apiIndex: -1 })
		assert.equal(snap1.apiIndex, -1)

		// Simulate: after API response, history has 1 entry → apiIndex = 0
		const snap2 = tc.transition(TaskPhase.EXECUTING, {
			apiIndex: 0,
			execution: { mode: "serial", executing: ["c1"] },
		})
		assert.equal(snap2.apiIndex, 0)
		assert.equal(snap2.phase, TaskPhase.EXECUTING)

		// Simulate: after another response, history has 3 entries → apiIndex = 2
		const snap3 = tc.transition(TaskPhase.AWAITING_APPROVAL, {
			apiIndex: 2,
			approval: {
				mode: "serial",
				blocks: [{ callId: "c2", name: "write_to_file", phase: "awaiting_approval" as any, apiIndex: 2 }],
				activeCallId: "c2",
			},
		})
		assert.equal(snap3.apiIndex, 2)
	})

	it("isValidApiIndex rejects -1 even when history is non-empty", () => {
		// -1 should never pass the guard, regardless of history size
		assert.equal(isValidApiIndex(-1, 3), false)
		assert.equal(isValidApiIndex(-1, 0), false)
		// Valid indices should pass
		assert.equal(isValidApiIndex(0, 3), true)
		assert.equal(isValidApiIndex(2, 3), true)
		// Out of bounds should be rejected
		assert.equal(isValidApiIndex(3, 3), false)
		// Non-integer and non-number should be rejected
		assert.equal(isValidApiIndex(1.5, 3), false)
		assert.equal(isValidApiIndex(null, 3), false)
		assert.equal(isValidApiIndex(undefined, 3), false)
	})
})
