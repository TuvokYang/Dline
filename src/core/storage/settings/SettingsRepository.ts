import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import * as path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Logger } from "@shared/services/Logger"
import type { Settings, SettingsKey } from "@shared/storage/state-keys"
import { SettingsKeys } from "@shared/storage/state-keys"
import chokidar, { type FSWatcher } from "chokidar"
import { FileLock } from "../FileLock"
import {
	SETTINGS_REPOSITORY_SCHEMA_VERSION,
	type SettingsCommit,
	type SettingsCommitListener,
	type SettingsRepositoryOptions,
	type SettingsSnapshot,
} from "./settings-types"
import { applySettingsPatch, buildPersistedSettingsDocument, parseSettingsDocument } from "./settings-validation"

const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100] as const
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"])
const SETTINGS_KEY_SET = new Set<string>(SettingsKeys as string[])

function cloneValues(values: Settings): Settings {
	return JSON.parse(JSON.stringify(values)) as Settings
}

function contentHash(values: Settings): string {
	return createHash("sha256").update(JSON.stringify(values)).digest("hex")
}

function snapshot(values: Settings, revision: number): SettingsSnapshot {
	const cloned = cloneValues(values)
	return Object.freeze({
		schemaVersion: SETTINGS_REPOSITORY_SCHEMA_VERSION,
		revision,
		values: Object.freeze(cloned),
		contentHash: contentHash(cloned),
	})
}

function changedKeys(previous: Settings, next: Settings): SettingsKey[] {
	const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
	return [...keys]
		.filter((key) => SETTINGS_KEY_SET.has(key) && !isDeepStrictEqual(previous[key as SettingsKey], next[key as SettingsKey]))
		.sort() as SettingsKey[]
}

async function readDocument(filePath: string): Promise<Record<string, unknown>> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
		throw error
	}
}

async function renameWithRetry(sourcePath: string, destinationPath: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error
			await new Promise<void>((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
		}
	}
}

async function atomicWriteDocument(filePath: string, document: Record<string, unknown>): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	const tempPath = `${filePath}.tmp.${Date.now()}.${randomUUID()}.json`
	try {
		await fs.writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
		await renameWithRetry(tempPath, filePath)
	} catch (error) {
		await fs.unlink(tempPath).catch(() => undefined)
		throw error
	}
}

export class SettingsRepository {
	private readonly fileLock = new FileLock()
	private readonly filePath: string
	private readonly listeners = new Set<SettingsCommitListener>()
	private readonly sourceId: string
	private readonly watchEnabled: boolean
	private currentSnapshot = snapshot({} as Settings, 0)
	private initialized = false
	private disposed = false
	private operationQueue: Promise<void> = Promise.resolve()
	private watcher?: FSWatcher

	constructor(options: SettingsRepositoryOptions) {
		this.filePath = options.filePath
		this.sourceId = options.sourceId ?? randomUUID()
		this.watchEnabled = options.watch ?? true
	}

	async initialize(): Promise<SettingsSnapshot> {
		if (this.initialized) return this.currentSnapshot
		const parsed = parseSettingsDocument(await readDocument(this.filePath))
		this.currentSnapshot = snapshot(parsed.values, parsed.revision)
		this.initialized = true
		if (this.watchEnabled) {
			await this.startWatcher()
			await this.enqueue(() => this.reconcileFromDisk())
		}
		return this.currentSnapshot
	}

	readSnapshot(): SettingsSnapshot {
		if (!this.initialized) throw new Error("SettingsRepository has not been initialized")
		return this.currentSnapshot
	}

	mutate(patch: Partial<Settings>, sourceId = this.sourceId): Promise<SettingsCommit> {
		return this.mutateResolved(() => patch, sourceId)
	}

	/** Resolve a Settings patch from the latest disk snapshot while holding the cross-process file lock. */
	mutateResolved(
		resolvePatch: (values: Readonly<Settings>) => Partial<Settings>,
		sourceId = this.sourceId,
	): Promise<SettingsCommit> {
		return this.enqueue(async () => {
			this.ensureAvailable()
			await fs.mkdir(path.dirname(this.filePath), { recursive: true })
			let commit: SettingsCommit | undefined
			await this.fileLock.withLock(this.filePath, async () => {
				const parsed = parseSettingsDocument(await readDocument(this.filePath))
				const nextValues = applySettingsPatch(parsed.values, resolvePatch(parsed.values))
				const keys = changedKeys(parsed.values, nextValues)
				if (isDeepStrictEqual(parsed.values, nextValues)) {
					this.currentSnapshot = snapshot(parsed.values, Math.max(parsed.revision, this.currentSnapshot.revision))
					commit = {
						revision: this.currentSnapshot.revision,
						changedKeys: [],
						snapshot: this.currentSnapshot,
						sourceId,
					}
					return
				}
				const revision = Math.max(parsed.revision, this.currentSnapshot.revision) + 1
				await atomicWriteDocument(this.filePath, buildPersistedSettingsDocument(nextValues, revision, sourceId))
				this.currentSnapshot = snapshot(nextValues, revision)
				commit = { revision, changedKeys: keys, snapshot: this.currentSnapshot, sourceId }
			})
			if (!commit) throw new Error("Settings transaction completed without a commit")
			if (commit.changedKeys.length > 0) await this.publish(commit)
			return commit
		})
	}

	subscribe(listener: SettingsCommitListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	async flush(): Promise<void> {
		await this.operationQueue
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		const watcher = this.watcher
		this.watcher = undefined
		if (watcher) await watcher.close()
		await this.operationQueue
		this.listeners.clear()
	}

	private ensureAvailable(): void {
		if (!this.initialized) throw new Error("SettingsRepository has not been initialized")
		if (this.disposed) throw new Error("SettingsRepository has been disposed")
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation)
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	private async startWatcher(): Promise<void> {
		const watcher = chokidar.watch(this.filePath, {
			persistent: true,
			ignoreInitial: true,
			atomic: true,
			awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
		})
		this.watcher = watcher
		const reconcile = () => {
			void this.enqueue(() => this.reconcileFromDisk()).catch((error) => {
				Logger.error("[SettingsRepository] Failed to reconcile external Settings commit:", error)
			})
		}
		watcher
			.on("add", reconcile)
			.on("change", reconcile)
			.on("unlink", reconcile)
			.on("error", (error) => {
				Logger.error("[SettingsRepository] Watcher error:", error)
			})
		await new Promise<void>((resolve) => {
			watcher.once("ready", resolve)
			watcher.once("error", () => resolve())
		})
	}

	private async reconcileFromDisk(): Promise<void> {
		if (this.disposed) return
		const parsed = parseSettingsDocument(await readDocument(this.filePath))
		const diskHash = contentHash(parsed.values)
		if (diskHash === this.currentSnapshot.contentHash) return
		if (parsed.revision > 0 && parsed.revision <= this.currentSnapshot.revision) return
		const previous = this.currentSnapshot
		const revision = parsed.revision > previous.revision ? parsed.revision : previous.revision + 1
		this.currentSnapshot = snapshot(parsed.values, revision)
		const keys = changedKeys(previous.values, this.currentSnapshot.values)
		if (keys.length === 0) return
		await this.publish({
			revision,
			changedKeys: keys,
			snapshot: this.currentSnapshot,
			sourceId: parsed.sourceId,
		})
	}

	private async publish(commit: SettingsCommit): Promise<void> {
		for (const listener of this.listeners) {
			try {
				await listener(commit)
			} catch (error) {
				Logger.error("[SettingsRepository] Commit listener failed:", error)
			}
		}
	}
}
