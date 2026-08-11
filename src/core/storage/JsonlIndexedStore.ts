import Mutex from "p-mutex"
import { FileLock } from "./FileLock"
import { readJsonl, writeJsonl } from "./jsonl-utils"

/**
 * Regex to extract the "ts" numeric field from a JSON line.
 * Avoids a full JSON.parse for L1 index building.
 */
const TS_EXTRACT_REGEX = /"ts"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/

/** Maximum number of fully-parsed entries cached in L2. */
const L2_MAX_SIZE = 500

/** Default flush interval in milliseconds. */
const DEFAULT_FLUSH_INTERVAL_MS = 1000

export interface JsonlIndexedStoreOptions {
	/**
	 * Treat append as creation even when its requested `ts` is already present.
	 * The store allocates a later unique timestamp locally and again while holding
	 * FileLock, so concurrent appenders cannot collapse distinct rows by identity.
	 */
	ensureUniqueAppendTs?: boolean
}

/**
 * Single-file indexed storage for JSONL entries.
 *
 * **Architecture:**
 * - **L1 index** (ts→void): lightweight, built at open(), ~40 bytes/entry
 * - **L2 cache** (ts→T): LRU parsed entries, max 500
 * - **_items[]** — virtual row index = array index = file line position
 *
 * **Write strategy: two-layer**
 * - **Memory layer**: all writes update _items/L1/L2 immediately, mark dirty
 * - **Flush layer**: timer → _flush() transaction (Mutex+FileLock) writes
 *   only the affected range to disk via writeJsonl (tmp+rename, atomic)
 *
 * **Merge strategy** (in _flush):
 * - Compare the local items with this instance's last persisted baseline
 * - Apply local updates and removals to the latest disk state by message identity (`ts`)
 * - Preserve rows appended by another instance after this store was opened
 * - Merge concurrent additions deterministically within their baseline gap
 * - Write the merged result atomically via writeJsonl
 *
 * @typeParam T Entry type — must include a numeric `ts` field
 */
export class JsonlIndexedStore<T extends { ts: number }> {
	private _filePath: string

	// ── L1 lightweight index ──
	private _l1Index: Map<number, void> = new Map()
	/** ts values in ascending order for binary search. */
	private _sortedTs: number[] = []

	// ── L2 parsed cache (LRU) ──
	private _l2Cache: Map<number, T> = new Map()
	private _l2AccessOrder: number[] = []

	// ── Full-load flag ──
	private _fullyLoaded = false
	/** Cached full array — virtual row index = array index = file line position */
	private _items: T[] = []

	// ── Dirty tracking ──
	private _dirty = false
	/** First modified virtual row index (0-based). _items.length means no dirty rows. */
	private _firstDirtyIndex = 0
	/** Last disk state observed by this instance, used for three-way merge. */
	private _persistedItems: T[] = []

	// ── Concurrency ──
	private _mutex = new Mutex()
	private _lock: FileLock
	private _loaded = false
	private _closing = false
	private _closed = false
	private _closePromise: Promise<void> | undefined

	// ── Flush timer ──
	private _flushTimer: ReturnType<typeof setInterval> | null = null
	private _flushIntervalMs: number
	private readonly _ensureUniqueAppendTs: boolean

	private constructor(filePath: string, flushIntervalMs: number, options: JsonlIndexedStoreOptions) {
		this._filePath = filePath
		this._lock = new FileLock()
		this._flushIntervalMs = flushIntervalMs
		this._ensureUniqueAppendTs = options.ensureUniqueAppendTs ?? false
	}

	// ──────────────── Factory ────────────────

	/**
	 * Open (or create) a JSONL file, build L1 index, start flush timer.
	 *
	 * @param filePath Absolute path to the `.jsonl` file
	 * @param flushIntervalMs Flush debounce interval in ms (default 1000 = 1s)
	 */
	static async open<T extends { ts: number }>(
		filePath: string,
		flushIntervalOrOptions: number | JsonlIndexedStoreOptions = DEFAULT_FLUSH_INTERVAL_MS,
	): Promise<JsonlIndexedStore<T>> {
		const flushIntervalMs = typeof flushIntervalOrOptions === "number" ? flushIntervalOrOptions : DEFAULT_FLUSH_INTERVAL_MS
		const options = typeof flushIntervalOrOptions === "number" ? {} : flushIntervalOrOptions
		const store = new JsonlIndexedStore<T>(filePath, flushIntervalMs, options)
		await store._ensureLoaded()
		store._startFlushTimer()
		return store
	}

	// ──────────────── Cache access (lock-free) ────────────────

	get count(): number {
		return this._items.length
	}

	/** Return read-only view of cached entries. Call loadAll() first for full data. */
	getAll(): ReadonlyArray<T> {
		return this._items
	}

	getByTs(ts: number): T | undefined {
		const cached = this._l2Cache.get(ts)
		if (cached !== undefined) {
			this._touchL2(ts)
			return cached
		}
		return undefined
	}

	async getByTsAsync(ts: number): Promise<T | undefined> {
		const cached = this._l2Cache.get(ts)
		if (cached !== undefined) {
			this._touchL2(ts)
			return cached
		}
		if (!this._l1Index.has(ts)) return undefined
		return this._loadEntryFromDisk(ts)
	}

	getAt(index: number): T | undefined {
		if (index < 0 || index >= this._items.length) return undefined
		return this._items[index]
	}

	findIndexByTs(ts: number): number {
		let lo = 0,
			hi = this._sortedTs.length
		while (lo < hi) {
			const mid = (lo + hi) >>> 1
			if (this._sortedTs[mid] < ts) lo = mid + 1
			else hi = mid
		}
		return lo
	}

	async getRecent(limit: number): Promise<T[]> {
		if (limit <= 0) return []
		const start = Math.max(0, this._sortedTs.length - limit)
		const result: T[] = []
		for (let i = start; i < this._sortedTs.length; i++) {
			const entry = await this.getByTsAsync(this._sortedTs[i])
			if (entry) result.push(entry)
		}
		return result
	}

	async getRange(fromTs: number, toTs: number): Promise<T[]> {
		const startIdx = this.findIndexByTs(fromTs)
		const result: T[] = []
		for (let i = startIdx; i < this._sortedTs.length; i++) {
			const ts = this._sortedTs[i]
			if (ts >= toTs) break
			const entry = await this.getByTsAsync(ts)
			if (entry) result.push(entry)
		}
		return result
	}

	async loadAll(force = false): Promise<void> {
		if (this._fullyLoaded && !force) return
		const raw = await readJsonl<T>(this._filePath)
		this._l2Cache.clear()
		this._l2AccessOrder = []
		this._setItems(raw)
		this._persistedItems = this._cloneItems(raw)
		this._rebuildTsIndex()
		this._fullyLoaded = true
		if (force) {
			this._dirty = false
			this._firstDirtyIndex = this._items.length
		}
	}

	get isFullyLoaded(): boolean {
		return this._fullyLoaded
	}

	// ──────────────── Memory-layer writes (append/update — no disk) ────────────────

	/**
	 * Append — memory only.  Flush timer will persist.
	 * Safe because append only adds to the end, never changes existing virtual row numbers.
	 */
	async append(item: T): Promise<void> {
		this._assertWritable()
		await this._mutex.withLock(async () => {
			const admittedItem = this._ensureUniqueAppendTs ? this._withLocallyUniqueAppendTs(item) : item
			this._items.push(admittedItem)
			this._l1Index.set(admittedItem.ts)
			this._sortedTs.push(admittedItem.ts)
			this._addToL2(admittedItem.ts, admittedItem)
			this._markDirty(this._items.length - 1)
		})
	}

	/**
	 * Insert at virtual row index — memory layer only (no disk write).
	 * Like append(), writes to _items + marks dirty; flush timer handles disk sync.
	 * Mutex-protected. Unlike insertAt(), does NOT use transact/FileLock.
	 *
	 * @param index Zero-based insertion position (appends if >= length)
	 * @param item The entry to insert
	 */
	async insertLine(index: number, item: T): Promise<void> {
		this._assertWritable()
		await this._mutex.withLock(async () => {
			if (index >= this._items.length) {
				this._items.push(item)
			} else {
				this._items.splice(index, 0, item)
			}
			this._l1Index.set(item.ts)
			this._rebuildTsIndex()
			this._addToL2(item.ts, item)
			this._markDirty(index)
		})
	}

	/**
	 * Update at virtual row index — memory only (content modification, structure unchanged).
	 * Ensures _fullyLoaded before updating so the index maps to the correct entry.
	 */
	async updateAt(index: number, item: T): Promise<void> {
		this._assertWritable()
		await this._mutex.withLock(async () => {
			await this._ensureFullyLoaded()
			if (index < 0 || index >= this._items.length) {
				throw new Error(`JsonlIndexedStore.updateAt: index ${index} out of range [0, ${this._items.length})`)
			}
			this._items[index] = item
			this._l1Index.set(item.ts)
			this._rebuildTsIndex()
			this._addToL2(item.ts, item)
			this._markDirty(index)
		})
	}

	/**
	 * Merge fields into an entry at a virtual row index and mark that row dirty.
	 * The read and write happen under the same mutex so concurrent field updates
	 * cannot replace one another with stale copies.
	 */
	async patchAt(index: number, updates: Partial<T>): Promise<T> {
		this._assertWritable()
		return await this._mutex.withLock(async () => {
			await this._ensureFullyLoaded()
			if (index < 0 || index >= this._items.length) {
				throw new Error(`JsonlIndexedStore.patchAt: index ${index} out of range [0, ${this._items.length})`)
			}
			const item = { ...this._items[index], ...updates }
			this._items[index] = item
			this._l1Index.set(item.ts)
			this._rebuildTsIndex()
			this._addToL2(item.ts, item)
			this._markDirty(index)
			return item
		})
	}

	/**
	 * Upsert by ts — memory only (content modification, structure unchanged).
	 * Ensures _fullyLoaded before upserting so ts-based lookup is accurate.
	 */
	async upsertByTs(item: T): Promise<void> {
		this._assertWritable()
		await this._mutex.withLock(async () => {
			await this._ensureFullyLoaded()
			const existingIdx = (() => {
				for (let i = this._items.length - 1; i >= 0; i--) {
					if (this._items[i].ts === item.ts) return i
				}
				return -1
			})()
			if (existingIdx >= 0) {
				this._items[existingIdx] = item
				this._addToL2(item.ts, item)
				this._markDirty(existingIdx)
			} else {
				this._items.push(item)
				this._l1Index.set(item.ts)
				this._sortedTs.push(item.ts)
				this._sortedTs.sort((a, b) => a - b)
				this._addToL2(item.ts, item)
				this._markDirty(0) // full sort needed — mark from start
			}
		})
	}

	/**
	 * Replace a single entry by ts (delegates to upsertByTs).
	 */
	async replaceByTs(ts: number, item: T): Promise<boolean> {
		if (!this._l1Index.has(ts)) return false
		await this.upsertByTs(item)
		return true
	}

	// ──────────────── Transaction-based writes (structural changes) ────────────────

	/**
	 * Delete at virtual row index via cross-process transaction.
	 * Structural change — uses transact for FileLock-protected atomicity.
	 */
	async deleteAt(index: number): Promise<void> {
		await this.transact((items) => {
			if (index < 0 || index >= items.length) {
				throw new Error(`JsonlIndexedStore.deleteAt: index ${index} out of range [0, ${items.length})`)
			}
			items.splice(index, 1)
			return items
		})
	}

	/**
	 * Delete multiple rows in a single cross-process transaction.
	 * Indices are sorted descending and removed from back to front to preserve validity.
	 *
	 * @param indices Array of virtual row indices to delete
	 */
	async deleteMany(indices: number[]): Promise<void> {
		if (indices.length === 0) return
		await this.transact((items) => {
			const sorted = [...indices].sort((a, b) => b - a) // descending
			for (const idx of sorted) {
				if (idx < 0 || idx >= items.length) {
					throw new Error(`JsonlIndexedStore.deleteMany: index ${idx} out of range [0, ${items.length})`)
				}
				items.splice(idx, 1)
			}
			return items
		})
	}

	/**
	 * Insert at virtual row index via cross-process transaction.
	 * Structural change — uses transact for FileLock-protected atomicity.
	 */
	async insertAt(index: number, item: T): Promise<void> {
		await this.transact((items) => {
			if (index >= items.length) {
				items.push(item)
			} else {
				items.splice(index, 0, item)
			}
			return items
		})
	}

	/**
	 * Clear all entries via cross-process transaction.
	 */
	async clear(): Promise<void> {
		await this.transact(() => [])
	}

	/**
	 * Truncate by virtual row count via cross-process transaction.
	 * Keeps only the first `count` rows, discards the rest.
	 *
	 * @param count Number of rows to keep (0 = clear all)
	 */
	async truncateByLineNum(count: number): Promise<void> {
		await this.transact((items) => items.slice(0, count))
	}

	/**
	 * Truncate by ts — keep only entries with ts < beforeTs.
	 * Delegates to truncateByLineNum after finding the cut index.
	 */
	async truncate(beforeTs: number): Promise<void> {
		const cutIndex = this.findIndexByTs(beforeTs)
		await this.truncateByLineNum(cutIndex)
	}

	// ──────────────── Transaction API (cross-process safe) ────────────────

	/**
	 * Execute a transformation within a cross-process transaction.
	 *
	 * **Flow**: Mutex → flush pending dirty data → FileLock → read disk → fn(items) → writeJsonl → update memory
	 *
	 * The `fn` receives the current disk state as a mutable array (ping-pong variable).
	 * Modifications to this array are written back atomically via writeJsonl.
	 * This is the single entry point for all structural modifications (delete/insert/truncate/clear/overwrite).
	 *
	 * @param fn Transformation function: receives current items, returns modified items
	 */
	async transact(fn: (items: T[]) => T[]): Promise<void> {
		this._assertWritable()
		await this._mutex.withLock(async () => {
			// Ensure all pending dirty data is flushed before reading disk
			await this._flushLocked()

			await this._lock.withLock(this._filePath, async () => {
				// Read current disk state (ping variable — captures cross-process appends)
				const diskItems = await readJsonl<T>(this._filePath)

				// Apply transformation
				const result = fn(diskItems)

				// Write back atomically
				await writeJsonl(this._filePath, result)

				// Update in-memory state (pong — memory now matches disk)
				this._items = result
				this._persistedItems = this._cloneItems(result)
				this._rebuildTsIndex()

				// Rebuild L2 cache to reflect new state (stale entries would break getByTs)
				this._l2Cache.clear()
				this._l2AccessOrder = []
				for (let i = 0; i < Math.min(result.length, L2_MAX_SIZE); i++) {
					if (result[i].ts > 0) this._addToL2(result[i].ts, result[i])
				}
			})

			// Reset dirty state — disk is now clean
			this._dirty = false
			this._firstDirtyIndex = this._items.length
		})
	}

	/**
	 * ⚠️ DANGEROUS: Overwrite all entries via a transaction.
	 * Prefer incremental operations (append/updateAt/deleteAt/transact) when possible.
	 */
	async overwrite(items: T[]): Promise<void> {
		await this.transact(() => [...items])
	}

	/**
	 * Compact — force flush to sync any pending dirty data.
	 */
	async compact(): Promise<void> {
		await this._mutex.withLock(async () => {
			await this._flushLocked()
		})
	}

	// ──────────────── Flush transaction ────────────────

	private _startFlushTimer(): void {
		if (this._flushTimer) return
		this._flushTimer = setInterval(() => {
			this._flush().catch(() => {
				/* ignore flush errors */
			})
		}, this._flushIntervalMs)
	}

	/**
	 * Public flush — call before critical operations (e.g. task save).
	 */
	async flush(): Promise<void> {
		await this._mutex.withLock(async () => {
			await this._flushLocked()
		})
	}

	private async _flush(): Promise<void> {
		if (!this._dirty) return
		await this._mutex.withLock(async () => {
			await this._flushLocked()
		})
	}

	/**
	 * Core flush logic (caller must hold _mutex).
	 * 1. Acquire FileLock
	 * 2. Read the latest complete disk state
	 * 3. Three-way merge local changes against the persisted baseline and latest disk state
	 * 4. Write the merged result atomically
	 * 5. Reset the persisted baseline and dirty state
	 */
	private async _flushLocked(): Promise<void> {
		if (!this._dirty) return

		await this._lock.withLock(this._filePath, async () => {
			// Merge against the latest disk state. FileLock serializes writers, while
			// the persisted baseline prevents a stale instance from deleting rows
			// appended by another task/window after this instance was opened.
			const diskItems = await readJsonl<T>(this._filePath)
			const merged = this._mergeWithDisk(diskItems)

			await writeJsonl(this._filePath, merged)
			this._items = merged
			this._persistedItems = this._cloneItems(merged)
			this._l2Cache.clear()
			this._l2AccessOrder = []
			this._rebuildTsIndex()
			for (let i = 0; i < Math.min(merged.length, L2_MAX_SIZE); i++) {
				if (merged[i].ts > 0) this._addToL2(merged[i].ts, merged[i])
			}
		})

		// Reset dirty state
		this._dirty = false
		this._firstDirtyIndex = this._items.length

		// Evict L2 entries to control memory (keep last L2_MAX_SIZE)
		this._evictL2()
	}

	/** Mark dirty with first affected virtual row index. */
	private _markDirty(index: number): void {
		this._dirty = true
		if (index < this._firstDirtyIndex) {
			this._firstDirtyIndex = Math.max(0, index)
		}
	}

	// ──────────────── Lifecycle ────────────────

	/**
	 * Stop accepting writes, stop the timer, and wait for the final atomic flush.
	 * The promise is idempotent so multiple lifecycle owners can safely await it.
	 */
	close(): Promise<void> {
		if (this._closePromise) return this._closePromise
		this._closing = true
		if (this._flushTimer) {
			clearInterval(this._flushTimer)
			this._flushTimer = null
		}
		this._closePromise = this._mutex.withLock(async () => {
			await this._flushLocked()
			this._closed = true
		})
		return this._closePromise
	}

	/** Compatibility cleanup for callers that cannot await disposal. */
	dispose(): void {
		void this.close().catch(() => {})
	}

	// ──────────────── Internal helpers ────────────────

	private async _ensureLoaded(): Promise<void> {
		if (this._loaded) return
		const { fileExistsAtPath } = await import("@/utils/fs")
		if (!(await fileExistsAtPath(this._filePath))) {
			this._loaded = true
			this._fullyLoaded = true
			this._firstDirtyIndex = 0
			return
		}
		const fs = await import("fs/promises")
		const content = await fs.readFile(this._filePath, "utf8")
		if (!content.trim()) {
			this._loaded = true
			this._fullyLoaded = true
			this._firstDirtyIndex = 0
			return
		}
		// Build L1 index + _items from file
		let _offset = 0
		const lines = content.split("\n")
		const entries: T[] = []
		for (const line of lines) {
			const trimmed = line.trim()
			const lineLen = line.length + 1
			if (!trimmed) {
				_offset += lineLen
				continue
			}
			const match = TS_EXTRACT_REGEX.exec(trimmed)
			if (match) {
				const ts = Number(match[1])
				if (!Number.isNaN(ts) && ts > 0) {
					this._l1Index.set(ts)
					this._sortedTs.push(ts)
				}
			}
			try {
				const entry = JSON.parse(trimmed) as T
				if (entry.ts > 0) {
					entries.push(entry)
					this._addToL2(entry.ts, entry)
				}
			} catch {
				/* skip malformed */
			}
			_offset += lineLen
		}
		this._sortedTs.sort((a, b) => a - b)
		this._items = entries
		this._persistedItems = this._cloneItems(entries)
		this._firstDirtyIndex = this._items.length
		this._loaded = true
		this._fullyLoaded = true
	}

	private async _loadEntryFromDisk(ts: number): Promise<T | undefined> {
		try {
			const entries = await readJsonl<T>(this._filePath)
			const found = entries.find((e) => e.ts === ts)
			if (found) {
				this._addToL2(ts, found)
				return found
			}
		} catch {
			/* ignore */
		}
		return undefined
	}

	private _addToL2(ts: number, entry: T): void {
		const existingIdx = this._l2AccessOrder.indexOf(ts)
		if (existingIdx >= 0) this._l2AccessOrder.splice(existingIdx, 1)
		while (this._l2Cache.size >= L2_MAX_SIZE && this._l2AccessOrder.length > 0) {
			const oldest = this._l2AccessOrder.shift()!
			this._l2Cache.delete(oldest)
		}
		this._l2Cache.set(ts, entry)
		this._l2AccessOrder.push(ts)
	}

	private _touchL2(ts: number): void {
		const idx = this._l2AccessOrder.indexOf(ts)
		if (idx >= 0) {
			this._l2AccessOrder.splice(idx, 1)
			this._l2AccessOrder.push(ts)
		}
	}

	private _rebuildTsIndex(): void {
		this._l1Index.clear()
		this._sortedTs = []
		for (const entry of this._items) {
			if (entry.ts > 0) {
				this._l1Index.set(entry.ts)
				this._sortedTs.push(entry.ts)
			}
		}
		this._sortedTs.sort((a, b) => a - b)
	}

	private _setItems(items: T[]): void {
		this._items = items
		for (let i = 0; i < Math.min(items.length, L2_MAX_SIZE); i++) {
			if (items[i].ts > 0) this._addToL2(items[i].ts, items[i])
		}
	}

	/**
	 * Ensure the in-memory _items array is fully loaded from disk.
	 * Call before any operation that relies on complete data (updateAt, upsertByTs).
	 */
	private async _ensureFullyLoaded(): Promise<void> {
		if (!this._fullyLoaded) {
			await this.loadAll()
		}
	}

	private _mergeWithDisk(diskItems: T[]): T[] {
		const baselineByTs = new Map(this._persistedItems.map((item) => [item.ts, item]))
		const baselineTs = new Set(baselineByTs.keys())
		const localByTs = new Map(this._items.map((item) => [item.ts, item]))
		const removedTs = new Set(this._persistedItems.filter((item) => !localByTs.has(item.ts)).map((item) => item.ts))
		let merged = diskItems.filter((item) => !removedTs.has(item.ts))

		const additions: Array<{ item: T; localIndex: number }> = []
		for (let localIndex = 0; localIndex < this._items.length; localIndex++) {
			const localItem = this._items[localIndex]
			const baselineItem = baselineByTs.get(localItem.ts)
			if (!baselineItem) {
				additions.push({ item: localItem, localIndex })
				continue
			}
			if (JSON.stringify(localItem) === JSON.stringify(baselineItem)) continue
			const diskIndex = merged.findIndex((item) => item.ts === localItem.ts)
			if (diskIndex >= 0) merged[diskIndex] = localItem
			else additions.push({ item: localItem, localIndex })
		}

		if (additions.length === 0) return merged

		if (this._ensureUniqueAppendTs) {
			const usedTs = new Set(merged.map((item) => item.ts))
			let maxUsedTs = merged.reduce((max, item) => Math.max(max, item.ts), 0)
			for (const addition of additions) {
				if (usedTs.has(addition.item.ts)) {
					let nextTs = Math.max(addition.item.ts, maxUsedTs) + 1
					while (usedTs.has(nextTs)) nextTs++
					addition.item = { ...addition.item, ts: nextTs }
					this._items[addition.localIndex] = addition.item
				}
				usedTs.add(addition.item.ts)
				maxUsedTs = Math.max(maxUsedTs, addition.item.ts)
			}
		}

		const localAdditionTs = new Set(additions.map(({ item }) => item.ts))
		merged = merged.filter((item) => !localAdditionTs.has(item.ts))
		const groups = new Map<string, { previousTs?: number; nextTs?: number; items: T[] }>()
		for (const addition of additions) {
			let previousTs: number | undefined
			let nextTs: number | undefined
			for (let i = addition.localIndex - 1; i >= 0; i--) {
				if (baselineTs.has(this._items[i].ts)) {
					previousTs = this._items[i].ts
					break
				}
			}
			for (let i = addition.localIndex + 1; i < this._items.length; i++) {
				if (baselineTs.has(this._items[i].ts)) {
					nextTs = this._items[i].ts
					break
				}
			}
			const key = `${previousTs ?? "start"}:${nextTs ?? "end"}`
			const group = groups.get(key) ?? { previousTs, nextTs, items: [] }
			group.items.push(addition.item)
			groups.set(key, group)
		}

		for (const group of groups.values()) {
			const previousIndex = group.previousTs === undefined ? -1 : merged.findIndex((item) => item.ts === group.previousTs)
			const nextIndex = group.nextTs === undefined ? merged.length : merged.findIndex((item) => item.ts === group.nextTs)
			const start = previousIndex >= 0 ? previousIndex + 1 : 0
			const end = nextIndex >= start ? nextIndex : merged.length
			const gap = merged.slice(start, end)
			if (gap.some((item) => baselineTs.has(item.ts))) {
				merged.splice(end, 0, ...group.items)
				continue
			}
			const byTs = new Map(gap.map((item) => [item.ts, item]))
			for (const item of group.items) byTs.set(item.ts, item)
			const ordered = [...byTs.values()].sort((left, right) => left.ts - right.ts)
			merged.splice(start, end - start, ...ordered)
		}

		return merged
	}

	private _cloneItems(items: T[]): T[] {
		return items.map((item) => JSON.parse(JSON.stringify(item)) as T)
	}

	private _withLocallyUniqueAppendTs(item: T): T {
		if (!this._l1Index.has(item.ts)) return item
		let nextTs = Math.max(item.ts, this._sortedTs.at(-1) ?? item.ts) + 1
		while (this._l1Index.has(nextTs)) nextTs++
		return { ...item, ts: nextTs }
	}

	private _assertWritable(): void {
		if (this._closing || this._closed) {
			throw new Error("JsonlIndexedStore is closed")
		}
	}

	private _evictL2(): void {
		// Keep only the most recent L2_MAX_SIZE entries
		while (this._l2AccessOrder.length > L2_MAX_SIZE) {
			const oldest = this._l2AccessOrder.shift()!
			this._l2Cache.delete(oldest)
		}
	}
}
