/**
 * Unit tests for FileLock — filesystem-based mutual exclusion for JSONL files.
 */
import { afterEach, describe, it } from "vitest"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { FileLock } from "../FileLock"

describe("FileLock", () => {
	let tmpDir: string
	const lock = new FileLock()

	afterEach(async () => {
		if (tmpDir) {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
	})

	async function mkTmpDir(): Promise<string> {
		const dir = path.join(os.tmpdir(), `filelock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(dir, { recursive: true })
		tmpDir = dir
		return dir
	}

	it("should acquire and release a lock successfully", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "test.jsonl")
		const lockPath = `${jsonlPath}.lck`

		await lock.acquire(jsonlPath)

		// Verify .lck file exists
		const lckExists = await fs
			.stat(lockPath)
			.then(() => true)
			.catch(() => false)
		lckExists.should.be.true()

		// Verify .lck file content
		const raw = await fs.readFile(lockPath, "utf8")
		const payload = JSON.parse(raw)
		payload.pid.should.equal(process.pid)
		payload.ts.should.be.within(Date.now() - 5000, Date.now())

		await lock.release(jsonlPath)

		// Verify .lck file is removed
		const lckGone = await fs
			.stat(lockPath)
			.then(() => false)
			.catch(() => true)
		lckGone.should.be.true()
	})

	it("should release silently when lock was never acquired", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "nonexistent.jsonl")

		// Should not throw
		await lock.release(jsonlPath)
	})

	it("should execute fn inside withLock and release afterwards", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "withlock.jsonl")

		let executed = false
		const result = await lock.withLock(jsonlPath, async () => {
			executed = true
			return "done"
		})

		executed.should.be.true()
		result.should.equal("done")

		// Lock should be released after withLock
		const lockPath = `${jsonlPath}.lck`
		const lckGone = await fs
			.stat(lockPath)
			.then(() => false)
			.catch(() => true)
		lckGone.should.be.true()
	})

	it("should release lock even if fn throws", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "throw.jsonl")

		try {
			await lock.withLock(jsonlPath, async () => {
				throw new Error("test error")
			})
		} catch (e: any) {
			e.message.should.equal("test error")
		}

		// Lock should be released even after exception
		const lockPath = `${jsonlPath}.lck`
		const lckGone = await fs
			.stat(lockPath)
			.then(() => false)
			.catch(() => true)
		lckGone.should.be.true()
	})

	it("should prevent concurrent acquisitions (mutual exclusion)", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "concurrent.jsonl")

		// First acquisition should succeed
		await lock.acquire(jsonlPath)

		// Second acquisition should fail (held by same process)
		try {
			await lock.acquire(jsonlPath)
			// If we reach here the test should fail
			throw new Error("Expected acquire to throw")
		} catch (e: any) {
			e.message.should.match(/Failed to acquire lock/)
		}

		await lock.release(jsonlPath)
	})

	it("should break stale locks (older than 10s)", async () => {
		const dir = await mkTmpDir()
		const jsonlPath = path.join(dir, "stale.jsonl")
		const lockPath = `${jsonlPath}.lck`

		// Create a lock file with an old timestamp (simulating a crashed process)
		const stalePayload = { pid: 99999, ts: Date.now() - 15_000 }
		await fs.writeFile(lockPath, JSON.stringify(stalePayload), "utf8")

		// Set mtime to 15s ago so isLockActive detects it as stale
		const oldTime = new Date(Date.now() - 15_000)
		await fs.utimes(lockPath, oldTime, oldTime)

		// Acquisition should break the stale lock and succeed
		await lock.acquire(jsonlPath)

		// Verify new lock has our pid
		const raw = await fs.readFile(lockPath, "utf8")
		const payload = JSON.parse(raw)
		payload.pid.should.equal(process.pid)

		await lock.release(jsonlPath)
	})
})
