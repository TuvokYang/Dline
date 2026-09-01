import * as fs from "node:fs"
import fsPromises from "node:fs/promises"
import * as path from "node:path"
import { Logger } from "../services/Logger"
import { ClineSyncStorage } from "./ClineStorage"

const ATOMIC_RENAME_MAX_ATTEMPTS = 3
const ATOMIC_RENAME_RETRY_DELAYS_MS = [10, 25] as const
const RETRYABLE_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

export interface ClineFileStorageOptions {
	/**
	 * File permissions mode (e.g., 0o600 for owner read/write only).
	 * If not set, uses the system default.
	 */
	fileMode?: number
}

/**
 * File-backed JSON storage.
 * Keeps synchronous methods for VSCode Memento compatibility and CLI environments,
 * while exposing an asynchronous batch path for Extension Host persistence.
 */
export class ClineFileStorage<T = any> extends ClineSyncStorage<T> {
	protected name: string
	private data: Record<string, T>
	private readonly fsPath: string
	private readonly fileMode?: number
	private asyncWriteQueue: Promise<void> = Promise.resolve()

	constructor(filePath: string, name = "ClineFileStorage", options?: ClineFileStorageOptions) {
		super()
		this.fsPath = filePath
		this.name = name
		this.fileMode = options?.fileMode
		this.data = this.readFromDisk()
	}

	protected _get(key: string): T | undefined {
		return this.data[key]
	}

	protected _set(key: string, value: T | undefined): void {
		// Use setBatch for consistency - all writes go through one path
		this.setBatch({ [key]: value })
	}

	protected _delete(key: string): void {
		this.setBatch({ [key]: undefined })
	}

	/**
	 * Set multiple keys in a single write operation.
	 * More efficient than calling set() for each key individually,
	 * since it only writes to disk once.
	 */
	public setBatch(entries: Record<string, T | undefined>): Thenable<void> {
		// Merge writes against the latest persisted snapshot so another process's
		// completed updates are not discarded by this instance's stale cache.
		const nextData = this.readFromDisk()
		const changedKeys: string[] = []
		for (const [key, value] of Object.entries(entries)) {
			if (value === undefined) {
				if (key in nextData) {
					delete nextData[key]
					changedKeys.push(key)
				}
			} else {
				nextData[key] = value
				changedKeys.push(key)
			}
		}
		if (changedKeys.length > 0) {
			this.writeToDisk(nextData)
		}
		this.data = nextData
		for (const key of changedKeys) {
			this.fireChange(key)
		}
		return Promise.resolve()
	}

	/**
	 * Set multiple keys without blocking the caller's event loop on filesystem I/O.
	 * Writes are serialized per storage instance and become observable only after
	 * the durable write succeeds.
	 */
	public setBatchAsync(entries: Record<string, T | undefined>): Promise<void> {
		const operation = this.asyncWriteQueue.then(async () => {
			const nextData = await this.readFromDiskAsync()
			const changedKeys = applyEntries(nextData, entries)
			if (changedKeys.length > 0) {
				await this.writeToDiskAsync(nextData)
			}
			this.data = nextData
			for (const key of changedKeys) {
				this.fireChange(key)
			}
		})
		this.asyncWriteQueue = operation.then(
			() => undefined,
			() => undefined,
		)
		return operation
	}

	/** Reload the in-memory snapshot from disk before a freshness-sensitive read. */
	public reload(): void {
		this.data = this.readFromDisk()
	}

	protected _keys(): readonly string[] {
		return Object.keys(this.data)
	}

	private readFromDisk(): Record<string, T> {
		try {
			if (fs.existsSync(this.fsPath)) {
				return JSON.parse(fs.readFileSync(this.fsPath, "utf-8"))
			}
		} catch (error) {
			Logger.error(`[${this.name}] failed to read from ${this.fsPath}:`, error)
		}
		return {}
	}

	private writeToDisk(data: Record<string, T>): void {
		try {
			const dir = path.dirname(this.fsPath)
			fs.mkdirSync(dir, { recursive: true })
			atomicWriteFileSync(this.fsPath, JSON.stringify(data, null, 2), this.fileMode)
		} catch (error) {
			Logger.error(`[${this.name}] failed to write to ${this.fsPath}:`, error)
			throw error
		}
	}

	private async readFromDiskAsync(): Promise<Record<string, T>> {
		try {
			return JSON.parse(await fsPromises.readFile(this.fsPath, "utf-8"))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				Logger.error(`[${this.name}] failed to read from ${this.fsPath}:`, error)
			}
			return {}
		}
	}

	private async writeToDiskAsync(data: Record<string, T>): Promise<void> {
		try {
			const dir = path.dirname(this.fsPath)
			await fsPromises.mkdir(dir, { recursive: true })
			await atomicWriteFile(this.fsPath, JSON.stringify(data, null, 2), this.fileMode)
		} catch (error) {
			Logger.error(`[${this.name}] failed to write to ${this.fsPath}:`, error)
			throw error
		}
	}
}

function applyEntries<T>(nextData: Record<string, T>, entries: Record<string, T | undefined>): string[] {
	const changedKeys: string[] = []
	for (const [key, value] of Object.entries(entries)) {
		if (value === undefined) {
			if (key in nextData) {
				delete nextData[key]
				changedKeys.push(key)
			}
		} else {
			nextData[key] = value
			changedKeys.push(key)
		}
	}
	return changedKeys
}

function waitForAtomicRenameRetry(delayMs: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, delayMs)
}

async function renameAtomicFile(sourcePath: string, destinationPath: string): Promise<void> {
	for (let attempt = 1; attempt <= ATOMIC_RENAME_MAX_ATTEMPTS; attempt++) {
		try {
			await fsPromises.rename(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_ATOMIC_RENAME_CODES.has(code) || attempt === ATOMIC_RENAME_MAX_ATTEMPTS) {
				throw error
			}
			await new Promise<void>((resolve) => setTimeout(resolve, ATOMIC_RENAME_RETRY_DELAYS_MS[attempt - 1] ?? 0))
		}
	}
}

function renameAtomicFileSync(sourcePath: string, destinationPath: string): void {
	for (let attempt = 1; attempt <= ATOMIC_RENAME_MAX_ATTEMPTS; attempt++) {
		try {
			fs.renameSync(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_ATOMIC_RENAME_CODES.has(code) || attempt === ATOMIC_RENAME_MAX_ATTEMPTS) {
				throw error
			}
			waitForAtomicRenameRetry(ATOMIC_RENAME_RETRY_DELAYS_MS[attempt - 1] ?? 0)
		}
	}
}

async function atomicWriteFile(filePath: string, data: string, mode?: fs.Mode | undefined): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		await fsPromises.writeFile(tmpPath, data, {
			flag: "wx",
			encoding: "utf-8",
			mode,
		})
		await renameAtomicFile(tmpPath, filePath)
	} catch (error) {
		await fsPromises.unlink(tmpPath).catch(() => undefined)
		throw error
	}
}

/**
 * Synchronously, atomically write data to a file using temp file + rename pattern.
 * Prefer the asynchronous batch path in Extension Host request flows.
 */
function atomicWriteFileSync(filePath: string, data: string, mode?: fs.Mode | undefined): void {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		fs.writeFileSync(tmpPath, data, {
			flag: "wx",
			encoding: "utf-8",
			mode,
		})
		renameAtomicFileSync(tmpPath, filePath)
	} catch (error) {
		// Clean up temp file if it exists
		try {
			fs.unlinkSync(tmpPath)
		} catch {}
		throw error
	}
}
