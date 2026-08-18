import chokidar, { FSWatcher } from "chokidar"
import { HistoryItem } from "@/shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import { JsonlIndexedStore } from "./JsonlIndexedStore"

/**
 * Task history store backed by taskHistory.jsonl.
 *
 * Manages the global task history list (one entry per task session).
 * Uses JsonlIndexedStore for lazy-loaded storage with internal
 * Mutex + FileLock for concurrency safety.
 *
 * There is only one taskHistory.jsonl per user.  The instance is created
 * and owned by StateManager, which passes it to consumers as needed.
 */
export class TaskHistory {
	private store: JsonlIndexedStore<HistoryItem>
	private _watcher: FSWatcher | null = null
	private _onChangeCallbacks: Array<() => void | Promise<void>> = []

	constructor(store: JsonlIndexedStore<HistoryItem>) {
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
		await this.store.loadAll()
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
	 * Insert or update a task history entry (full transact, cross-process safe).
	 *
	 * @param item The history item to upsert
	 */
	async upsert(item: HistoryItem): Promise<void> {
		await this.store.transact((items) => {
			const existingIdx = items.findIndex((d) => (d as HistoryItem).id === item.id)
			if (existingIdx >= 0) {
				items[existingIdx] = item as unknown as (typeof items)[0]
			} else {
				items.push(item as unknown as (typeof items)[0])
			}
			return items
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
	 * Delete a task by id — removes the entry directly from the store.
	 * Cross-process safe via transact + FileLock.
	 */
	async softDelete(id: string): Promise<void> {
		await this.store.transact((items) => {
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
		await this.store.transact((items) => {
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

	/**
	 * Reload the L1 index from disk (called by chokidar watcher).
	 */
	async reloadIndex(): Promise<void> {
		// Force reload from disk to pick up cross-process writes (chokidar sync)
		await this.store.loadAll(true)
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
	 * Memory-layer only; disk sync handled by the store's flush timer (10s interval).
	 * Cross-process safe: _flushLocked uses FileLock + disk merge strategy.
	 *
	 * @param item The history item to upsert
	 */
	async upsertTaskHistory(item: HistoryItem): Promise<void> {
		await this.store.loadAll()
		const all = this.store.getAll() as HistoryItem[]
		const existingIndex = all.findIndex((m) => m.id === item.id)

		if (existingIndex >= 0) {
			// Replace in-place (memory-level + markDirty)
			await this.store.updateAt(existingIndex, item as any)
		} else {
			// Find insertion position by ts (ascending order)
			let insertIndex = all.length
			for (let i = 0; i < all.length; i++) {
				if (all[i].ts > item.ts) {
					insertIndex = i
					break
				}
			}
			// Insert at correct position (memory-level + markDirty)
			await this.store.insertLine(insertIndex, item as any)
		}
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

			const syncFromDisk = async () => {
				try {
					await this.reloadIndex()
				} catch (err) {
					Logger.error("[TaskHistory] Failed to reload on file change:", err)
				}
			}

			this._watcher
				.on("add", () => syncFromDisk())
				.on("change", () => syncFromDisk())
				.on("unlink", async () => {
					await this.store.overwrite([])
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

	/** Stop watchers and flush/close the underlying JSONL store. */
	async dispose(): Promise<void> {
		const watcher = this._watcher
		this._watcher = null
		this._onChangeCallbacks = []
		if (watcher) {
			await watcher.close()
		}
		await this.store.close()
	}
}
