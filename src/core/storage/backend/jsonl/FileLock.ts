import { randomUUID } from "node:crypto"
import * as path from "node:path"
import fs from "fs/promises"
import { Logger } from "@/shared/services/Logger"

/**
 * Structure of the .lck lock file.
 * Written as JSON to a file adjacent to the protected JSONL file.
 */
interface LockPayload {
	/** Process ID that owns the lock */
	pid: number
	/** Unique acquisition identity, including between lock instances in one process. */
	ownerId?: string
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
const MAX_RELEASE_ATTEMPTS = 5
const RELEASE_RETRY_DELAYS_MS = [10, 25, 50, 100] as const
const RETRYABLE_RELEASE_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES"])

/**
 * Derive the lock file path from a JSONL file path.
 * Lock file is `<jsonl_path>.lck`.
 */
function lockPathFor(jsonlPath: string): string {
	return `${jsonlPath}.lck`
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * Check whether a lock file exists and is still active.
 * A young lock is active unconditionally. An older lock remains active while
 * its owner process exists, preventing a long atomic write from being broken.
 */
async function isLockActive(lockPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(lockPath)
		const age = Date.now() - stat.mtimeMs
		if (age < STALE_LOCK_TIMEOUT_MS) return true
		const payload = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockPayload
		return typeof payload.ownerId === "string" && payload.ownerId.length > 0 && isProcessAlive(payload.pid)
	} catch {
		// Missing or unreadable old lock → not active and eligible for cleanup.
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
	private readonly ownedLocks = new Map<string, string>()

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
		const ownerId = randomUUID()
		const startedAt = performance.now()

		for (let attempt = 1; attempt <= MAX_ACQUIRE_RETRIES; attempt++) {
			const payload: LockPayload = {
				pid: process.pid,
				ownerId,
				ts: Date.now(),
			}

			try {
				// `wx` is an atomic create-if-absent operation. Unlike stat + writeFile,
				// it cannot let two windows or two lock instances both become owners.
				const openStartedAt = performance.now()
				const handle = await fs.open(lockPath, "wx")
				const openedAt = performance.now()
				let writtenAt = openedAt
				let closedAt = openedAt
				try {
					await handle.writeFile(JSON.stringify(payload), "utf8")
					writtenAt = performance.now()
				} finally {
					await handle.close()
					closedAt = performance.now()
				}
				this.ownedLocks.set(jsonlPath, ownerId)
				// Bounded retry caps contention at roughly one second, so a longer
				// acquire on the first attempt means the filesystem call itself was
				// slow rather than the lock being held elsewhere.
				const durationMs = Math.round(performance.now() - startedAt)
				if (durationMs >= 250) {
					Logger.debug(
						`[FileLockPerf] phase=acquire path=${path.basename(lockPath)} attempts=${attempt} openMs=${Math.round(openedAt - openStartedAt)} writeMs=${Math.round(writtenAt - openedAt)} closeMs=${Math.round(closedAt - writtenAt)} durationMs=${durationMs}`,
					)
				}
				return
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			}

			if (!(await isLockActive(lockPath))) {
				await breakStaleLock(lockPath)
				continue
			}
			if (attempt === MAX_ACQUIRE_RETRIES) {
				throw new Error(`[FileLock] Failed to acquire lock after ${MAX_ACQUIRE_RETRIES} attempts: ${lockPath}`)
			}
			await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS))
		}

		throw new Error(`[FileLock] Failed to acquire lock after all retries: ${lockPath}`)
	}

	/**
	 * Release the lock for a JSONL file.
	 * Safe to call if this instance never acquired the lock. Transient Windows
	 * unlink failures are retried; a persistent owned-lock failure is surfaced.
	 *
	 * @param jsonlPath Absolute path to the protected JSONL file
	 */
	async release(jsonlPath: string): Promise<void> {
		const ownerId = this.ownedLocks.get(jsonlPath)
		if (!ownerId) return
		const lockPath = lockPathFor(jsonlPath)
		let payload: LockPayload
		try {
			payload = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockPayload
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				this.ownedLocks.delete(jsonlPath)
			}
			return
		}
		if (payload.ownerId !== ownerId) {
			this.ownedLocks.delete(jsonlPath)
			return
		}

		for (let attempt = 1; attempt <= MAX_RELEASE_ATTEMPTS; attempt++) {
			try {
				await fs.unlink(lockPath)
				this.ownedLocks.delete(jsonlPath)
				return
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code
				if (code === "ENOENT") {
					this.ownedLocks.delete(jsonlPath)
					return
				}
				if (!code || !RETRYABLE_RELEASE_ERROR_CODES.has(code) || attempt === MAX_RELEASE_ATTEMPTS) {
					throw new Error(`[FileLock] Failed to release owned lock: ${lockPath}`, { cause: error })
				}
				await new Promise<void>((resolve) => setTimeout(resolve, RELEASE_RETRY_DELAYS_MS[attempt - 1] ?? 0))
			}
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
