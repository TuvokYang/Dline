import chokidar, { FSWatcher } from "chokidar"
import Mutex from "p-mutex"
import { HistoryItem } from "@/shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import type { BufferedUnifyStore } from "./backend/api/UnifyStore"

export interface TaskCompletionStateUpdate {
	taskId: string
	isCompleted: boolean
	revision: number
}

/** Canonical completion projection of one Task. */
interface CompletionProjection {
	isCompleted: boolean
	revision: number
}

/** Read the canonical completion projection carried by a persisted row. */
function readCompletionProjection(item: HistoryItem | undefined): CompletionProjection | undefined {
	if (!item || item.completionStateRevision === undefined) return undefined
	return { isCompleted: item.isCompleted === true, revision: item.completionStateRevision }
}

/** Select the projection produced by the newer revision. */
function newerProjection(
	left: CompletionProjection | undefined,
	right: CompletionProjection | undefined,
): CompletionProjection | undefined {
	if (!left) return right
	if (!right) return left
	return right.revision > left.revision ? right : left
}

/** Preserve the canonical completion projection while merging ordinary metadata. */
function mergeCompletionProjection(projection: CompletionProjection | undefined, incoming: HistoryItem): HistoryItem {
	const merged = { ...incoming }
	delete merged.isCompleted
	delete merged.completionStateRevision
	if (projection) {
		merged.isCompleted = projection.isCompleted
		merged.completionStateRevision = projection.revision
	}
	return merged
}

/**
 * Task history store backed by taskHistory.jsonl.
 *
 * Manages the global task history list (one entry per task session).
 * Uses the backend-neutral buffered layer over the raw JSONL backend.
 *
 * There is only one taskHistory.jsonl per user.  The instance is created
 * and owned by StateManager, which passes it to consumers as needed.
 */
/**
 * Quiet period before a disk change is pulled into the in-memory index.
 *
 * A reload takes the cross-process file lock and re-reads the whole history, so
 * one reload per change event made every window fight for the same lock while a
 * writer already held it. Coalescing turns a burst into a single reload.
 */
const RELOAD_COALESCE_DELAY_MS = 250

export class TaskHistory {
	private store: BufferedUnifyStore<HistoryItem>
	private readonly completionWriteMutex = new Mutex()
	/**
	 * Last completion projection this process observed per Task.
	 *
	 * The buffered store serves metadata updates from an in-memory list that can
	 * lag behind a durable completion write performed by this or another window.
	 * Without this watermark a stale row would silently drop the checkmark on the
	 * next ordinary metadata flush.
	 */
	private readonly knownProjections = new Map<string, CompletionProjection>()
	private _watcher: FSWatcher | null = null
	private _onChangeCallbacks: Array<() => void | Promise<void>> = []
	private _reloadTimer: NodeJS.Timeout | null = null
	private _reloadInFlight: Promise<void> | null = null
	private _reloadRequestedWhileInFlight = false
	/** Tail of staged metadata writes still settling in the background. */
	private _pendingStage: Promise<void> = Promise.resolve()

	constructor(store: BufferedUnifyStore<HistoryItem>) {
		this.store = store
	}

	/**
	 * Register a callback invoked when the taskHistory file changes
	 * on disk (e.g. from another VSCode window).  Returns a disposal function.
	 */
	onChange(cb: () => void | Promise<void>): () => void {
		this._onChangeCallbacks.push(cb)
		return () => {
			const idx = this._onChangeCallbacks.indexOf(cb)
			if (idx >= 0) this._onChangeCallbacks.splice(idx, 1)
		}
	}

	// ── Read ──

	/** Total number of task history entries (including soft-deleted). */
	get count(): number {
		return this.store.count
	}

	/**
	 * Return all entries (loads full data from disk on first call).
	 * Excludes soft-deleted entries.
	 */
	async getAll(): Promise<HistoryItem[]> {
		await this.store.reload()
		const all = this.store.getAll() as ReadonlyArray<HistoryItem & { _deleted?: boolean }>
		return [...all].filter((item) => !(item as any)._deleted).sort((a, b) => b.ts - a.ts)
	}

	/**
	 * Return deduplicated entries (by id, keeping the last occurrence).
	 * Excludes soft-deleted entries.
	 */
	async getDeduplicated(): Promise<HistoryItem[]> {
		const all = await this.getAll()
		const byId = new Map<string, HistoryItem>()
		for (const item of all) {
			byId.set(item.id, item)
		}
		return [...byId.values()].sort((a, b) => b.ts - a.ts)
	}

	/**
	 * Return the most recent N entries (without loading full history).
	 */
	async getRecent(limit: number): Promise<HistoryItem[]> {
		if (limit <= 0) return []
		const entries = await this.store.getRecent(limit)
		return entries.filter((e) => !(e as any)._deleted)
	}

	/**
	 * Look up a single entry by task id.
	 * Loads all data on first call (needed because we index by ts, not id).
	 */
	async getById(id: string): Promise<HistoryItem | undefined> {
		const all = await this.getAll()
		return all.find((item) => item.id === id && !(item as any)._deleted)
	}

	// ── Write ──

	/**
	 * Insert or update a task history entry with one durable mutation.
	 *
	 * @param item The history item to upsert
	 */
	async upsert(item: HistoryItem): Promise<void> {
		await this.completionWriteMutex.withLock(async () => {
			await this.store.mutate((items) => {
				const existingIdx = items.findIndex((d) => (d as HistoryItem).id === item.id)
				if (existingIdx >= 0) {
					const projection = newerProjection(
						readCompletionProjection(items[existingIdx]),
						this.knownProjections.get(item.id),
					)
					this.rememberProjection(item.id, projection)
					items[existingIdx] = mergeCompletionProjection(projection, item) as unknown as (typeof items)[0]
				} else {
					const projection = this.knownProjections.get(item.id)
					items.push(mergeCompletionProjection(projection, item) as unknown as (typeof items)[0])
				}
				return items
			})
		})
	}

	/**
	 * Toggle the favorite status of a task.
	 *
	 * @param id Task id
	 * @returns The new favorite status, or undefined if task not found
	 */
	async toggleFavorite(id: string): Promise<boolean | undefined> {
		const all = await this.getAll()
		const item = all.find((i) => i.id === id)
		if (!item) return undefined

		const updated = { ...item, isFavorited: !item.isFavorited }
		await this.upsert(updated)
		return updated.isFavorited
	}

	/**
	 * Delete a task by id with one durable mutation.
	 */
	async softDelete(id: string): Promise<void> {
		await this.store.mutate((items) => {
			const filtered = items.filter((i) => (i as HistoryItem).id !== id)
			return filtered
		})
	}

	/**
	 * Delete all tasks except those marked as favorite.
	 *
	 * @returns Number of tasks deleted
	 */
	async deleteAllExceptFavorites(): Promise<number> {
		let deleted = 0
		await this.store.mutate((items) => {
			const before = items.length
			const favorited = items.filter((i) => (i as HistoryItem).isFavorited === true)
			deleted = before - favorited.length
			return favorited
		})
		return deleted
	}

	/** Clear all task history. */
	async clearAll(): Promise<void> {
		await this.store.clear()
	}

	/**
	 * Update metadata for a specific task (called from MessageStateHandler).
	 *
	 * @param item Full history item with updated metadata
	 */
	async updateMetadata(item: HistoryItem): Promise<void> {
		await this.upsert(item)
	}

	/** Durably patch one Task completion projection without replacing unrelated metadata. */
	async setCompletionState(update: TaskCompletionStateUpdate): Promise<HistoryItem | undefined> {
		return await this.completionWriteMutex.withLock(async () => {
			let updated: HistoryItem | undefined
			await this.store.mutate((items) => {
				const existingIndex = items.findIndex((item) => item.id === update.taskId)
				if (existingIndex < 0) return items

				const existing = items[existingIndex]
				if (!existing) return items
				const current = newerProjection(readCompletionProjection(existing), this.knownProjections.get(update.taskId))
				if (current && (current.revision >= update.revision || current.isCompleted === update.isCompleted)) {
					this.rememberProjection(update.taskId, current)
					return items
				}

				updated = {
					...existing,
					isCompleted: update.isCompleted,
					completionStateRevision: update.revision,
				}
				items[existingIndex] = updated
				return items
			})
			if (updated) {
				this.rememberProjection(update.taskId, {
					isCompleted: update.isCompleted,
					revision: update.revision,
				})
			}
			return updated
		})
	}

	/** Record the newest completion projection observed for one Task. */
	private rememberProjection(taskId: string, projection: CompletionProjection | undefined): void {
		if (!projection) return
		const merged = newerProjection(this.knownProjections.get(taskId), projection)
		if (merged) this.knownProjections.set(taskId, merged)
	}

	/**
	 * Reload the L1 index from disk (called by chokidar watcher).
	 */
	async reloadIndex(): Promise<void> {
		// Force reload from disk to pick up cross-process writes (chokidar sync)
		await this.store.reload(true)
		// Notify listeners
		for (const cb of this._onChangeCallbacks) {
			try {
				await cb()
			} catch {
				/* ignore per-listener errors */
			}
		}
	}

	/**
	 * Upsert a task history entry by id.
	 * Staged in memory; the buffered store flushes through the JSONL backend.
	 *
	 * @param item The history item to upsert
	 * @returns The staged row, carrying the canonical completion projection.
	 */
	async upsertTaskHistory(item: HistoryItem): Promise<HistoryItem> {
		return await this.completionWriteMutex.withLock(() => {
			// No reload here: `reload()` without `force` is a no-op, and a forced one
			// would take the cross-process lock to re-read the whole file on a UI hot
			// path. Cross-process writes arrive through the watcher instead.
			const all = this.store.getAll() as HistoryItem[]
			const existingIndex = all.findIndex((m) => m.id === item.id)

			if (existingIndex >= 0) {
				// Replace in-place (memory-level + markDirty) without overwriting the canonical completion projection.
				// The buffered row can be older than a completion already written by
				// this or another window, so the remembered projection wins on revision.
				const projection = newerProjection(
					readCompletionProjection(all[existingIndex]),
					this.knownProjections.get(item.id),
				)
				this.rememberProjection(item.id, projection)
				const staged = mergeCompletionProjection(projection, item)
				this.trackStage(this.store.stageUpdateAt(existingIndex, staged))
				return staged
			}

			// Find insertion position by ts (ascending order)
			let insertIndex = all.length
			for (let i = 0; i < all.length; i++) {
				if (all[i].ts > item.ts) {
					insertIndex = i
					break
				}
			}
			// Insert at correct position (memory-level + markDirty)
			const staged = mergeCompletionProjection(this.knownProjections.get(item.id), item)
			this.trackStage(this.store.stageInsertAt(insertIndex, staged))
			return staged
		})
	}

	/**
	 * Let a staged write settle in the background.
	 *
	 * Metadata updates sit on the UI hot path and only mutate the buffered
	 * in-memory list; the durable write happens later through the flush timer.
	 * Awaiting the stage made every task update wait behind whatever the store
	 * was doing, so callers now return immediately while `flush` still joins the
	 * staged tail before reporting durability.
	 */
	private trackStage(stage: Promise<void>): void {
		this._pendingStage = this._pendingStage.then(
			() => stage,
			() => stage,
		)
		void this._pendingStage.catch((error) => Logger.error("[TaskHistory] Failed to stage a metadata update:", error))
	}

	/** Persist all staged metadata updates. Used by durability and shutdown barriers. */
	async flush(): Promise<void> {
		await this._pendingStage.catch(() => undefined)
		await this.store.flush()
	}

	/**
	 * Collapse superseded revisions of each task into a single latest entry.
	 *
	 * The file is append-structured: every metadata update of a task rewrites the
	 * whole record, so a long-lived history accumulates dozens of dead revisions
	 * per task. Every write then has to rewrite that entire file while holding
	 * the cross-process lock, which is what starves other windows.
	 *
	 * Compaction is only worth its own full rewrite when there is a real
	 * surplus, so it is a no-op below `minRedundantEntries` extra rows.
	 *
	 * @param minRedundantEntries Superseded rows required before rewriting.
	 * @returns Number of removed rows, or 0 when nothing was rewritten.
	 */
	async compact(minRedundantEntries = 1_000): Promise<number> {
		return await this.completionWriteMutex.withLock(async () => {
			const all = this.store.getAll() as ReadonlyArray<HistoryItem & { _deleted?: boolean }>
			const latestById = new Map<string, HistoryItem>()
			for (const item of all) {
				// Later entries supersede earlier ones for the same task.
				latestById.set(item.id, item)
			}
			const removed = all.length - latestById.size
			if (removed < minRedundantEntries) return 0
			const compacted = [...latestById.values()].sort((left, right) => left.ts - right.ts)
			await this.store.replaceAll(compacted)
			await this.store.flush()
			Logger.info(`[TaskHistory] Compacted history: ${all.length} -> ${compacted.length} entries`)
			return removed
		})
	}

	/**
	 * Start the chokidar file watcher for cross-process sync.
	 * Called once after construction by the owner (StateManager).
	 *
	 * @param filePath Absolute path to taskHistory.jsonl
	 */
	async startWatcher(filePath: string): Promise<void> {
		try {
			if (this._watcher) {
				await this._watcher.close()
				this._watcher = null
			}

			this._watcher = chokidar.watch(filePath, {
				persistent: true,
				ignoreInitial: true,
				atomic: true,
				awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
			})

			this._watcher
				.on("add", () => this.scheduleReload())
				.on("change", () => this.scheduleReload())
				.on("unlink", async () => {
					await this.store.replaceAll([])
					for (const cb of this._onChangeCallbacks) {
						try {
							await cb()
						} catch {
							/* ignore */
						}
					}
				})
				.on("error", (error) => Logger.error("[TaskHistory] Watcher error:", error))
		} catch (err) {
			Logger.error("[TaskHistory] Failed to start file watcher:", err)
		}
	}

	/**
	 * Coalesce disk-change notifications into a single reload.
	 *
	 * Every window watches the same file, and a reload takes the cross-process
	 * lock to re-read the whole history. Reloading once per event made the
	 * windows queue up behind a writer that already held the lock, exhausting its
	 * bounded retry budget. Only one reload runs at a time; changes observed
	 * while it runs trigger exactly one follow-up.
	 */
	private scheduleReload(): void {
		if (this._reloadInFlight) {
			this._reloadRequestedWhileInFlight = true
			return
		}
		if (this._reloadTimer) clearTimeout(this._reloadTimer)
		this._reloadTimer = setTimeout(() => {
			this._reloadTimer = null
			this._reloadInFlight = this.runCoalescedReload().finally(() => {
				this._reloadInFlight = null
				if (this._reloadRequestedWhileInFlight) {
					this._reloadRequestedWhileInFlight = false
					this.scheduleReload()
				}
			})
		}, RELOAD_COALESCE_DELAY_MS)
		this._reloadTimer.unref?.()
	}

	private async runCoalescedReload(): Promise<void> {
		try {
			await this.reloadIndex()
		} catch (err) {
			// Losing a reload only costs freshness: the next change reschedules one,
			// and the in-memory index still serves the last known state. Contention
			// on a busy history file is expected, so it must not surface as an error.
			Logger.debug(`[TaskHistory] Deferred reload after file change: ${err instanceof Error ? err.message : err}`)
		}
	}

	/** Stop watchers and flush/close the underlying JSONL store. */
	async dispose(): Promise<void> {
		const watcher = this._watcher
		this._watcher = null
		this._onChangeCallbacks = []
		if (this._reloadTimer) {
			clearTimeout(this._reloadTimer)
			this._reloadTimer = null
		}
		this._reloadRequestedWhileInFlight = false
		if (watcher) {
			await watcher.close()
		}
		// Let an in-flight reload settle so it cannot touch a closed store.
		await this._reloadInFlight?.catch(() => undefined)
		await this.store.close()
	}
}
