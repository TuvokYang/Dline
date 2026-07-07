import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import { TaskPhase } from "../TaskPhase"
import type { TaskSnapshot } from "../TaskSnapshot"
import { TaskSnapshotPersistence } from "../TaskSnapshotPersistence"

/**
 * Creates a snapshot for persistence scheduling tests.
 * @param apiIndex API history index for the snapshot.
 * @param timestamp Snapshot timestamp.
 * @returns A TaskSnapshot object.
 */
function snapshot(apiIndex: number, timestamp: number): TaskSnapshot {
	return {
		phase: TaskPhase.STREAMING,
		apiIndex,
		timestamp,
	}
}

describe("TaskSnapshotPersistence", () => {
	it("coalesces snapshot json writes into a 100ms interval", async () => {
		const clock = vi.useFakeTimers()
		const writes: TaskSnapshot[] = []
		try {
			const persistence = new TaskSnapshotPersistence({
				writeSnapshot: async (value) => {
					writes.push(value)
				},
			})

			persistence.schedule(snapshot(1, 10))
			persistence.schedule(snapshot(2, 20))

			await clock.advanceTimersByTimeAsync(99)
			assert.equal(writes.length, 0)

			await clock.advanceTimersByTimeAsync(1)
			assert.equal(writes.length, 1)
			assert.equal(writes[0].apiIndex, 2)
		} finally {
			clock.useRealTimers()
		}
	})

	it("flushNow writes the latest pending snapshot immediately", async () => {
		const clock = vi.useFakeTimers()
		const writes: TaskSnapshot[] = []
		try {
			const persistence = new TaskSnapshotPersistence({
				writeSnapshot: async (value) => {
					writes.push(value)
				},
			})

			persistence.schedule(snapshot(1, 10))
			persistence.schedule(snapshot(2, 20))
			await persistence.flushNow()

			assert.equal(writes.length, 1)
			assert.equal(writes[0].apiIndex, 2)

			await clock.advanceTimersByTimeAsync(100)
			assert.equal(writes.length, 1)
		} finally {
			clock.useRealTimers()
		}
	})
})
