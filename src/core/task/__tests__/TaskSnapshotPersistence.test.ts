import { strict as assert } from "node:assert"
import { describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { TaskPhase } from "../TaskPhase"
import type { TaskSnapshot } from "../TaskSnapshot"
import { renameTaskSnapshotWithRetry, TaskSnapshotPersistence } from "../TaskSnapshotPersistence"

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

	it("retains the latest snapshot after a failed write and retries it on a later flush", async () => {
		const attempted: TaskSnapshot[] = []
		const persisted: TaskSnapshot[] = []
		let failNextWrite = true
		const persistence = new TaskSnapshotPersistence({
			writeSnapshot: async (value) => {
				attempted.push(value)
				if (failNextWrite) {
					failNextWrite = false
					throw new Error("disk unavailable")
				}
				persisted.push(value)
			},
		})

		persistence.schedule(snapshot(1, 10))
		persistence.schedule(snapshot(2, 20))

		await expect(persistence.flushNow()).rejects.toThrow("disk unavailable")
		await expect(persistence.flushNow()).resolves.toBeUndefined()

		expect(attempted.map((value) => value.apiIndex)).toEqual([2, 2])
		expect(persisted.map((value) => value.apiIndex)).toEqual([2])
	})
})

describe("renameTaskSnapshotWithRetry", () => {
	it.each(["EPERM", "EACCES", "EBUSY"])("retries a transient %s rename with the same paths", async (code) => {
		const sourcePath = "C:\\tasks\\123\\snapshot.json.tmp.1"
		const destinationPath = "C:\\tasks\\123\\snapshot.json"
		const renameFile = vi
			.fn<(sourcePath: string, destinationPath: string) => Promise<void>>()
			.mockRejectedValueOnce(
				Object.assign(new Error(`${code}: snapshot locked`), {
					code,
					syscall: "rename",
					path: sourcePath,
					dest: destinationPath,
				}),
			)
			.mockResolvedValue(undefined)
		const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined)
		const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)

		try {
			await expect(renameTaskSnapshotWithRetry(sourcePath, destinationPath, { renameFile, sleep })).resolves.toBeUndefined()

			expect(renameFile).toHaveBeenCalledTimes(2)
			expect(renameFile).toHaveBeenNthCalledWith(1, sourcePath, destinationPath)
			expect(renameFile).toHaveBeenNthCalledWith(2, sourcePath, destinationPath)
			expect(sleep).toHaveBeenCalledOnce()
			expect(warn).toHaveBeenCalledWith("[TaskSnapshotPersistence] Failed to rename task snapshot", {
				code,
				syscall: "rename",
				path: sourcePath,
				dest: destinationPath,
				attempt: 1,
			})
		} finally {
			warn.mockRestore()
		}
	})

	it("stops after three retryable rename attempts and logs the final failure fields", async () => {
		const sourcePath = "C:\\tasks\\123\\snapshot.json.tmp.2"
		const destinationPath = "C:\\tasks\\123\\snapshot.json"
		const error = Object.assign(new Error("EPERM: snapshot locked"), {
			code: "EPERM",
			syscall: "rename",
			path: sourcePath,
			dest: destinationPath,
		})
		const renameFile = vi.fn<(sourcePath: string, destinationPath: string) => Promise<void>>().mockRejectedValue(error)
		const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined)
		const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)

		try {
			await expect(renameTaskSnapshotWithRetry(sourcePath, destinationPath, { renameFile, sleep })).rejects.toBe(error)

			expect(renameFile).toHaveBeenCalledTimes(3)
			expect(sleep).toHaveBeenNthCalledWith(1, 10)
			expect(sleep).toHaveBeenNthCalledWith(2, 25)
			expect(sleep).toHaveBeenCalledTimes(2)
			expect(warn).toHaveBeenLastCalledWith("[TaskSnapshotPersistence] Failed to rename task snapshot", {
				code: "EPERM",
				syscall: "rename",
				path: sourcePath,
				dest: destinationPath,
				attempt: 3,
			})
		} finally {
			warn.mockRestore()
		}
	})

	it("does not retry a non-lock-related rename failure", async () => {
		const sourcePath = "C:\\tasks\\123\\snapshot.json.tmp.3"
		const destinationPath = "C:\\tasks\\123\\snapshot.json"
		const error = Object.assign(new Error("ENOSPC: disk full"), {
			code: "ENOSPC",
			syscall: "rename",
			path: sourcePath,
			dest: destinationPath,
		})
		const renameFile = vi.fn<(sourcePath: string, destinationPath: string) => Promise<void>>().mockRejectedValue(error)
		const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined)
		const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)

		try {
			await expect(renameTaskSnapshotWithRetry(sourcePath, destinationPath, { renameFile, sleep })).rejects.toBe(error)

			expect(renameFile).toHaveBeenCalledOnce()
			expect(sleep).not.toHaveBeenCalled()
			expect(warn).toHaveBeenCalledWith("[TaskSnapshotPersistence] Failed to rename task snapshot", {
				code: "ENOSPC",
				syscall: "rename",
				path: sourcePath,
				dest: destinationPath,
				attempt: 1,
			})
		} finally {
			warn.mockRestore()
		}
	})
})
