import fs from "fs/promises"
import { Logger } from "@/shared/services/Logger"

/**
 * Structure of the .lck lock file.
 * Written as JSON to a file adjacent to the protected JSONL file.
 */
interface LockPayload {
	/** Process ID that owns the lock */
	pid: number
	/** Timestamp when the lock was acquired (ms since epoch) */
	ts: number
}

/**
 * Maximum age of a lock file before it is considered stale (10 seconds).
 * If a process crashes without releasing its lock, another process
 * can break the stale lock after this timeout.
 */
const STALE_LOCK_TIMEOUT_MS = 10_000

/**
 * Maximum number of acquire retries when lock is held by another active process.
 * Each retry waits 100ms, giving a total timeout of ~1 second.
 */
const MAX_ACQUIRE_RETRIES = 10
const ACQUIRE_RETRY_DELAY_MS = 100

/**
 * Derive the lock file path from a JSONL file path.
 * Lock file is `<jsonl_path>.lck`.
 */
function lockPathFor(jsonlPath: string): string {
	return `${jsonlPath}.lck`
}

/**
 * Check whether a lock file exists and is NOT stale.
 * Returns true if the lock is still active (held by a live process).
 */
async function isLockActive(lockPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(lockPath)
		const age = Date.now() - stat.mtimeMs
		return age < STALE_LOCK_TIMEOUT_MS
	} catch {
		// Lock file does not exist → not active
		return false
	}
}

/**
 * Remove a stale lock file, logging a warning.
 */
async function breakStaleLock(lockPath: string): Promise<void> {
	try {
		const raw = await fs.readFile(lockPath, "utf8")
		const payload = JSON.parse(raw) as LockPayload
		Logger.warn(`[FileLock] Breaking stale lock: path=${lockPath}, ownerPid=${payload.pid}, age=${Date.now() - payload.ts}ms`)
	} catch {
		// Corrupted lock — just warn generically
		Logger.warn(`[FileLock] Breaking stale/corrupted lock: path=${lockPath}`)
	}
	try {
		await fs.unlink(lockPath)
	} catch {
		// Best-effort cleanup
	}
}

/**
 * Low-level filesystem lock using a .lck file adjacent to a JSONL file.
 *
 * Inspired by the task history lock in disk.ts, but generalised for
 * any JSONL-backed store.  Guarantees that at most one Node.js process
 * (or VSCode window) holds the lock at any given time.
 *
 * Usage:
 *   const lock = new FileLock()
 *   await lock.withLock(jsonlPath, async () => {
 *       await appendJsonl(jsonlPath, item)
 *   })
 */
export class FileLock {
	/**
	 * Acquire the lock for a JSONL file.
	 *
	 * Blocks (with bounded retry) if another active process holds the lock.
	 * Breaks stale locks (older than 10s) automatically.
	 *
	 * @param jsonlPath Absolute path to the protected JSONL file
	 * @throws If unable to acquire the lock after MAX_ACQUIRE_RETRIES
	 */
	async acquire(jsonlPath: string): Promise<void> {
		const lockPath = lockPathFor(jsonlPath)

		for (let attempt = 1; attempt <= MAX_ACQUIRE_RETRIES; attempt++) {
			if (await isLockActive(lockPath)) {
				if (attempt === MAX_ACQUIRE_RETRIES) {
					throw new Error(`[FileLock] Failed to acquire lock after ${MAX_ACQUIRE_RETRIES} attempts: ${lockPath}`)
				}
				await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS))
				continue
			}

			// If a lock file exists but is stale, break it first
			try {
				await fs.stat(lockPath)
				// File exists → must be stale (isLockActive returned false)
				await breakStaleLock(lockPath)
			} catch {
				// File does not exist — proceed
			}

			// Create the lock file
			const payload: LockPayload = {
				pid: process.pid,
				ts: Date.now(),
			}
			await fs.writeFile(lockPath, JSON.stringify(payload), "utf8")

			// Double-check: verify we actually hold the lock by re-reading it
			// (guards against a TOCTOU race between stat and writeFile)
			try {
				const raw = await fs.readFile(lockPath, "utf8")
				const written = JSON.parse(raw) as LockPayload
				if (written.pid === process.pid) {
					return // Lock acquired successfully
				}
			} catch {
				// Re-read failed — another process likely won the race
			}

			// Another process won the race; clean up our lock file and retry
			try {
				await fs.unlink(lockPath)
			} catch {
				/* best-effort */
			}
			if (attempt < MAX_ACQUIRE_RETRIES) {
				await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS))
			}
		}

		throw new Error(`[FileLock] Failed to acquire lock after all retries: ${lockPath}`)
	}

	/**
	 * Release the lock for a JSONL file.
	 * Safe to call even if the lock was never acquired — errors are silently ignored.
	 *
	 * @param jsonlPath Absolute path to the protected JSONL file
	 */
	async release(jsonlPath: string): Promise<void> {
		const lockPath = lockPathFor(jsonlPath)
		try {
			await fs.unlink(lockPath)
		} catch {
			// Lock file already gone or never created — ignore
		}
	}

	/**
	 * Execute a function while holding the file lock.
	 * The lock is released even if the function throws.
	 *
	 * @param jsonlPath Absolute path to the protected JSONL file
	 * @param fn The guarded function to execute
	 * @returns The return value of fn
	 */
	async withLock<T>(jsonlPath: string, fn: () => Promise<T>): Promise<T> {
		await this.acquire(jsonlPath)
		try {
			return await fn()
		} finally {
			await this.release(jsonlPath)
		}
	}
}
