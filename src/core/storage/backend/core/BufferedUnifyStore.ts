import Mutex from "p-mutex"
import type { EntityFieldRef } from "../api/EntitySchema"
import type {
	BufferedUnifyStoreChangeListener,
	BufferedUnifyStore as BufferedUnifyStoreContract,
	UnifyStore,
} from "../api/UnifyStore"
import { asc } from "../api/UnifyStoreQuery"

const L2_MAX_SIZE = 500
const DEFAULT_FLUSH_INTERVAL_MS = 1_000

export interface BufferedUnifyStoreMapping<TEntity extends object, TItem extends { ts: number }> {
	readonly ordinal: EntityFieldRef<TEntity, number>
	readonly timestamp: EntityFieldRef<TEntity, number>
	toItem(entity: TEntity): TItem
	toEntity(item: TItem, ordinal: number): TEntity
}

export interface BufferedUnifyStoreOptions<TItem extends { ts: number }> {
	readonly flushIntervalMs?: number
	readonly ensureUniqueAppendTimestamp?: boolean
	readonly subscriptionKey: string
	readonly acceptInitialItem?: (item: TItem) => boolean
	readonly truncateTail?: (keepCount: number, expectedCount: number) => Promise<void>
}

interface SubscriptionState {
	generation: number
	listeners: Set<BufferedUnifyStoreChangeListener>
}

const subscriptions = new Map<string, SubscriptionState>()

export class BufferedUnifyStore<TEntity extends object, TItem extends { ts: number }>
	implements BufferedUnifyStoreContract<TItem>
{
	private readonly mutex = new Mutex()
	private readonly flushIntervalMs: number
	private readonly ensureUniqueAppendTimestamp: boolean
	private readonly subscriptionState: SubscriptionState
	private readonly ownedListeners = new Set<BufferedUnifyStoreChangeListener>()
	private readonly acceptInitialItem: (item: TItem) => boolean
	private readonly truncateTail?: (keepCount: number, expectedCount: number) => Promise<void>
	private flushTimer: ReturnType<typeof setInterval> | undefined
	private closing = false
	private closed = false
	private closePromise: Promise<void> | undefined
	private dirty = false
	private items: TItem[] = []
	private persistedItems: TItem[] = []
	private sortedTimestamps: number[] = []
	private l2Cache = new Map<number, TItem>()
	private l2AccessOrder: number[] = []

	private constructor(
		private readonly store: UnifyStore<TEntity>,
		private readonly mapping: BufferedUnifyStoreMapping<TEntity, TItem>,
		options: BufferedUnifyStoreOptions<TItem>,
	) {
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
		this.ensureUniqueAppendTimestamp = options.ensureUniqueAppendTimestamp ?? false
		this.subscriptionState = getSubscriptionState(options.subscriptionKey)
		this.acceptInitialItem = options.acceptInitialItem ?? (() => true)
		this.truncateTail = options.truncateTail
	}

	static async open<TEntity extends object, TItem extends { ts: number }>(options: {
		store: UnifyStore<TEntity>
		mapping: BufferedUnifyStoreMapping<TEntity, TItem>
		bufferOptions: BufferedUnifyStoreOptions<TItem>
	}): Promise<BufferedUnifyStore<TEntity, TItem>> {
		const buffered = new BufferedUnifyStore(options.store, options.mapping, options.bufferOptions)
		try {
			await buffered.loadInitialState()
			buffered.startFlushTimer()
			return buffered
		} catch (error) {
			await options.store.close().catch(() => undefined)
			throw error
		}
	}

	get count(): number {
		return this.items.length
	}

	get isFullyLoaded(): boolean {
		return true
	}

	getAll(): ReadonlyArray<TItem> {
		return this.items
	}

	getByTimestamp(timestamp: number): TItem | undefined {
		const cached = this.l2Cache.get(timestamp)
		if (cached) this.touchL2(timestamp)
		return cached
	}

	getAt(index: number): TItem | undefined {
		if (index < 0 || index >= this.items.length) return undefined
		return this.items[index]
	}

	findTimestampIndex(timestamp: number): number {
		let low = 0
		let high = this.sortedTimestamps.length
		while (low < high) {
			const middle = (low + high) >>> 1
			if (this.sortedTimestamps[middle] < timestamp) low = middle + 1
			else high = middle
		}
		return low
	}

	async getRecent(limit: number): Promise<TItem[]> {
		if (limit <= 0) return []
		const start = Math.max(0, this.sortedTimestamps.length - limit)
		return this.sortedTimestamps
			.slice(start)
			.map((timestamp) => this.resolveByTimestamp(timestamp))
			.filter(isDefined)
	}

	async getRange(fromTimestamp: number, toTimestamp: number): Promise<TItem[]> {
		const result: TItem[] = []
		for (let index = this.findTimestampIndex(fromTimestamp); index < this.sortedTimestamps.length; index++) {
			const timestamp = this.sortedTimestamps[index]
			if (timestamp >= toTimestamp) break
			const item = this.resolveByTimestamp(timestamp)
			if (item) result.push(item)
		}
		return result
	}

	async reload(force = false): Promise<void> {
		if (!force) return
		await this.mutex.withLock(async () => {
			const items = await this.readCommittedItems(false)
			this.setCommittedState(items)
			this.dirty = false
		})
	}

	async append(item: TItem): Promise<void> {
		this.assertWritable()
		await this.mutex.withLock(() => {
			const admitted = this.ensureUniqueAppendTimestamp ? this.withLocallyUniqueTimestamp(item) : item
			this.items.push(admitted)
			this.rebuildTimestampIndex()
			this.addToL2(admitted.ts, admitted)
			this.dirty = true
		})
	}

	async appendDurable(item: TItem): Promise<TItem> {
		this.assertWritable()
		return await this.mutex.withLock(async () => {
			const tailAdditions = this.dirty ? this.getPureTailAdditions() : []
			if (!tailAdditions) {
				throw new Error("BufferedUnifyStore.appendDurable requires a clean or append-only buffer")
			}
			const admitted = this.ensureUniqueAppendTimestamp ? this.withLocallyUniqueTimestamp(item) : item
			if (this.items.some((candidate) => candidate.ts === admitted.ts)) {
				throw new Error(`BufferedUnifyStore.appendDurable: timestamp ${admitted.ts} already exists`)
			}
			const additions = [...tailAdditions, admitted]
			await this.store.insert(
				additions.map((addition, index) => this.mapping.toEntity(addition, this.persistedItems.length + index)),
			)
			this.setCommittedState([...this.persistedItems, ...additions])
			this.dirty = false
			this.publishCommittedChange()
			return admitted
		})
	}

	async stageInsertAt(index: number, item: TItem): Promise<void> {
		this.assertWritable()
		await this.mutex.withLock(() => {
			if (index >= this.items.length) this.items.push(item)
			else this.items.splice(Math.max(0, index), 0, item)
			this.rebuildTimestampIndex()
			this.addToL2(item.ts, item)
			this.dirty = true
		})
	}

	async stageUpdateAt(index: number, item: TItem): Promise<void> {
		this.assertWritable()
		await this.mutex.withLock(() => {
			this.assertIndex("stageUpdateAt", index)
			this.items[index] = item
			this.rebuildTimestampIndex()
			this.addToL2(item.ts, item)
			this.dirty = true
		})
	}

	async stagePatchAt(index: number, updates: Partial<TItem>): Promise<TItem> {
		this.assertWritable()
		return await this.mutex.withLock(() => {
			this.assertIndex("stagePatchAt", index)
			const item = { ...this.items[index], ...updates }
			this.items[index] = item
			this.rebuildTimestampIndex()
			this.addToL2(item.ts, item)
			this.dirty = true
			return item
		})
	}

	async stageUpsertByTimestamp(item: TItem): Promise<void> {
		this.assertWritable()
		await this.mutex.withLock(() => {
			const index = this.findLastTimestampIndex(item.ts)
			if (index >= 0) this.items[index] = item
			else this.items.push(item)
			this.rebuildTimestampIndex()
			this.addToL2(item.ts, item)
			this.dirty = true
		})
	}

	async removeAt(index: number): Promise<void> {
		await this.mutate((items) => {
			if (index < 0 || index >= items.length) {
				throw new Error(`BufferedUnifyStore.removeAt: index ${index} out of range [0, ${items.length})`)
			}
			items.splice(index, 1)
			return items
		})
	}

	async insertAt(index: number, item: TItem): Promise<void> {
		await this.mutate((items) => {
			if (index >= items.length) items.push(item)
			else items.splice(Math.max(0, index), 0, item)
			return items
		})
	}

	async clear(): Promise<void> {
		this.assertWritable()
		// A freshly created task clears an already-empty store on its startup path.
		// Routing that through `mutate` costs a flush plus a full query/replaceAll
		// transaction for no state change, which is pure latency before the first
		// request. Skip the round trip when there is provably nothing to remove.
		if (this.items.length === 0 && this.persistedItems.length === 0 && !this.dirty) {
			return
		}
		await this.mutate(() => [])
	}

	async truncateAt(count: number): Promise<void> {
		const keepCount = Math.min(this.items.length, Math.max(0, count))
		const truncateTail = this.truncateTail
		if (!truncateTail) {
			await this.mutate((items) => items.slice(0, keepCount))
			return
		}
		this.assertWritable()
		await this.mutex.withLock(async () => {
			const retained = this.items.slice(0, keepCount)
			const persistedPrefixLength = Math.min(keepCount, this.persistedItems.length)
			for (let index = 0; index < persistedPrefixLength; index++) {
				// Same reference short-circuit as the append path: an untouched entry
				// is still the identical object, so only replaced entries need the
				// expensive structural comparison.
				if (retained[index] === this.persistedItems[index]) continue
				if (JSON.stringify(retained[index]) !== JSON.stringify(this.persistedItems[index])) {
					throw new Error("BufferedUnifyStore.truncateAt cannot preserve a structurally modified prefix")
				}
			}
			if (keepCount > this.persistedItems.length) {
				const tailAdditions = this.getPureTailAdditions()
				if (!tailAdditions) throw new Error("BufferedUnifyStore.truncateAt requires an append-only dirty tail")
				const retainedAdditions = retained.slice(this.persistedItems.length)
				if (retainedAdditions.length > 0) {
					await this.store.insert(
						retainedAdditions.map((item, index) => this.mapping.toEntity(item, this.persistedItems.length + index)),
					)
				}
			} else if (keepCount < this.persistedItems.length) {
				await truncateTail(keepCount, this.persistedItems.length)
			}
			this.setCommittedState(retained)
			this.dirty = false
			this.publishCommittedChange()
		})
	}

	async truncateBeforeTimestamp(timestamp: number): Promise<void> {
		await this.truncateAt(this.findTimestampIndex(timestamp))
	}

	async mutate(transform: (items: TItem[]) => TItem[]): Promise<void> {
		this.assertWritable()
		await this.mutex.withLock(async () => {
			await this.flushLocked()
			let result: TItem[] = []
			await this.store.transaction(async (transaction) => {
				const entities = await transaction.query({ orderBy: [asc(this.mapping.ordinal)] })
				result = transform(entities.map((entity) => this.mapping.toItem(entity)))
				await transaction.replaceAll(result.map((item, ordinal) => this.mapping.toEntity(item, ordinal)))
			})
			this.setCommittedState(result)
			this.publishCommittedChange()
		})
	}

	async replaceAll(items: readonly TItem[]): Promise<void> {
		await this.mutate(() => [...items])
	}

	async flush(): Promise<void> {
		await this.mutex.withLock(() => this.flushLocked())
	}

	subscribe(listener: BufferedUnifyStoreChangeListener): () => void {
		this.subscriptionState.listeners.add(listener)
		this.ownedListeners.add(listener)
		return () => {
			this.subscriptionState.listeners.delete(listener)
			this.ownedListeners.delete(listener)
		}
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise
		this.closing = true
		if (this.flushTimer) clearInterval(this.flushTimer)
		this.flushTimer = undefined
		this.closePromise = this.mutex.withLock(async () => {
			await this.flushLocked()
			for (const listener of this.ownedListeners) this.subscriptionState.listeners.delete(listener)
			this.ownedListeners.clear()
			await this.store.close()
			this.closed = true
		})
		return this.closePromise
	}

	private async loadInitialState(): Promise<void> {
		this.setCommittedState(await this.readCommittedItems(true))
	}

	private async readCommittedItems(initial: boolean): Promise<TItem[]> {
		const result = await this.store.query({ orderBy: [asc(this.mapping.ordinal)] })
		const items: TItem[] = []
		for (const entity of result.records) {
			try {
				const item = this.mapping.toItem(entity)
				if (!initial || this.acceptInitialItem(item)) items.push(item)
			} catch {
				// Invalid persisted records are isolated at the compatibility boundary.
			}
		}
		return items
	}

	private startFlushTimer(): void {
		this.flushTimer = setInterval(() => {
			void this.flush().catch(() => undefined)
		}, this.flushIntervalMs)
		this.flushTimer.unref?.()
	}

	private async flushLocked(): Promise<void> {
		if (!this.dirty) return
		const tailAdditions = this.getPureTailAdditions()
		if (tailAdditions) {
			await this.store.insert(
				tailAdditions.map((item, index) => this.mapping.toEntity(item, this.persistedItems.length + index)),
			)
			this.setCommittedState([...this.persistedItems, ...tailAdditions])
			this.dirty = false
			this.publishCommittedChange()
			return
		}
		let merged: TItem[] = []
		await this.store.transaction(async (transaction) => {
			const entities = await transaction.query({ orderBy: [asc(this.mapping.ordinal)] })
			const committed = entities.map((entity) => this.mapping.toItem(entity))
			merged = this.mergeWithCommitted(committed)
			await transaction.replaceAll(merged.map((item, ordinal) => this.mapping.toEntity(item, ordinal)))
		})
		this.setCommittedState(merged)
		this.dirty = false
		this.publishCommittedChange()
	}

	private getPureTailAdditions(): TItem[] | undefined {
		if (this.ensureUniqueAppendTimestamp || this.items.length <= this.persistedItems.length) return undefined
		for (let index = 0; index < this.persistedItems.length; index++) {
			// Reference equality settles the common case without serializing: an
			// untouched prefix still holds the very objects the baseline captured,
			// because staging replaces whole entries instead of mutating them.
			// Serializing every retained entry on each flush turned an append into
			// work proportional to the entire history.
			if (this.items[index] === this.persistedItems[index]) continue
			if (JSON.stringify(this.items[index]) !== JSON.stringify(this.persistedItems[index])) return undefined
		}
		return this.items.slice(this.persistedItems.length)
	}

	private mergeWithCommitted(committedItems: TItem[]): TItem[] {
		const baselineByTimestamp = new Map(this.persistedItems.map((item) => [item.ts, item]))
		const baselineTimestamps = new Set(baselineByTimestamp.keys())
		const localByTimestamp = new Map(this.items.map((item) => [item.ts, item]))
		const removedTimestamps = new Set(
			this.persistedItems.filter((item) => !localByTimestamp.has(item.ts)).map((item) => item.ts),
		)
		let merged = committedItems.filter((item) => !removedTimestamps.has(item.ts))
		const additions: Array<{ item: TItem; localIndex: number }> = []

		for (let localIndex = 0; localIndex < this.items.length; localIndex++) {
			const localItem = this.items[localIndex]
			const baselineItem = baselineByTimestamp.get(localItem.ts)
			if (!baselineItem) {
				additions.push({ item: localItem, localIndex })
				continue
			}
			if (JSON.stringify(localItem) === JSON.stringify(baselineItem)) continue
			const committedIndex = merged.findIndex((item) => item.ts === localItem.ts)
			if (committedIndex >= 0) merged[committedIndex] = localItem
			else additions.push({ item: localItem, localIndex })
		}

		if (additions.length === 0) return merged
		if (this.ensureUniqueAppendTimestamp) this.allocateUniqueCommittedTimestamps(merged, additions)

		const additionTimestamps = new Set(additions.map(({ item }) => item.ts))
		merged = merged.filter((item) => !additionTimestamps.has(item.ts))
		const groups = new Map<string, { previous?: number; next?: number; items: TItem[] }>()
		for (const addition of additions) {
			const previous = findBaselineTimestamp(this.items, baselineTimestamps, addition.localIndex, -1)
			const next = findBaselineTimestamp(this.items, baselineTimestamps, addition.localIndex, 1)
			const key = `${previous ?? "start"}:${next ?? "end"}`
			const group = groups.get(key) ?? { previous, next, items: [] }
			group.items.push(addition.item)
			groups.set(key, group)
		}

		for (const group of groups.values()) {
			const previousIndex = group.previous === undefined ? -1 : merged.findIndex((item) => item.ts === group.previous)
			const nextIndex = group.next === undefined ? merged.length : merged.findIndex((item) => item.ts === group.next)
			const start = previousIndex >= 0 ? previousIndex + 1 : 0
			const end = nextIndex >= start ? nextIndex : merged.length
			const gap = merged.slice(start, end)
			if (gap.some((item) => baselineTimestamps.has(item.ts))) {
				merged.splice(end, 0, ...group.items)
				continue
			}
			const byTimestamp = new Map(gap.map((item) => [item.ts, item]))
			for (const item of group.items) byTimestamp.set(item.ts, item)
			merged.splice(start, end - start, ...[...byTimestamp.values()].sort((left, right) => left.ts - right.ts))
		}
		return merged
	}

	private allocateUniqueCommittedTimestamps(
		committed: readonly TItem[],
		additions: Array<{ item: TItem; localIndex: number }>,
	): void {
		const used = new Set(committed.map((item) => item.ts))
		let maximum = committed.reduce((value, item) => Math.max(value, item.ts), 0)
		for (const addition of additions) {
			if (used.has(addition.item.ts)) {
				let next = Math.max(addition.item.ts, maximum) + 1
				while (used.has(next)) next += 1
				addition.item = { ...addition.item, ts: next }
				this.items[addition.localIndex] = addition.item
			}
			used.add(addition.item.ts)
			maximum = Math.max(maximum, addition.item.ts)
		}
	}

	private setCommittedState(items: TItem[]): void {
		this.items = items
		// The baseline is only ever read: it is compared against `this.items` and
		// sliced, never written through. Every staging path replaces a whole entry
		// (`this.items[index] = item`) or builds a new object from a spread, so no
		// entry is mutated in place and the two arrays cannot alias into each other.
		//
		// Deep-cloning every entry here doubled both the load time and the resident
		// memory of a task's message history, which for a large task meant copying
		// tens of megabytes on open before anything could be displayed.
		this.persistedItems = [...items]
		this.l2Cache.clear()
		this.l2AccessOrder = []
		this.rebuildTimestampIndex()
		for (let index = 0; index < Math.min(items.length, L2_MAX_SIZE); index++) {
			if (items[index].ts > 0) this.addToL2(items[index].ts, items[index])
		}
	}

	private resolveByTimestamp(timestamp: number): TItem | undefined {
		const cached = this.getByTimestamp(timestamp)
		if (cached) return cached
		const item = [...this.items].reverse().find((candidate) => candidate.ts === timestamp)
		if (item) this.addToL2(timestamp, item)
		return item
	}

	private rebuildTimestampIndex(): void {
		this.sortedTimestamps = this.items
			.filter((item) => item.ts > 0)
			.map((item) => item.ts)
			.sort((left, right) => left - right)
	}

	private addToL2(timestamp: number, item: TItem): void {
		const existing = this.l2AccessOrder.indexOf(timestamp)
		if (existing >= 0) this.l2AccessOrder.splice(existing, 1)
		while (this.l2Cache.size >= L2_MAX_SIZE && this.l2AccessOrder.length > 0) {
			const oldest = this.l2AccessOrder.shift()
			if (oldest !== undefined) this.l2Cache.delete(oldest)
		}
		this.l2Cache.set(timestamp, item)
		this.l2AccessOrder.push(timestamp)
	}

	private touchL2(timestamp: number): void {
		const index = this.l2AccessOrder.indexOf(timestamp)
		if (index < 0) return
		this.l2AccessOrder.splice(index, 1)
		this.l2AccessOrder.push(timestamp)
	}

	private withLocallyUniqueTimestamp(item: TItem): TItem {
		if (!this.sortedTimestamps.includes(item.ts)) return item
		let next = Math.max(item.ts, this.sortedTimestamps.at(-1) ?? item.ts) + 1
		while (this.sortedTimestamps.includes(next)) next += 1
		return { ...item, ts: next }
	}

	private findLastTimestampIndex(timestamp: number): number {
		for (let index = this.items.length - 1; index >= 0; index--) {
			if (this.items[index].ts === timestamp) return index
		}
		return -1
	}

	private assertIndex(operation: string, index: number): void {
		if (index < 0 || index >= this.items.length) {
			throw new Error(`BufferedUnifyStore.${operation}: index ${index} out of range [0, ${this.items.length})`)
		}
	}

	private assertWritable(): void {
		if (this.closing || this.closed) throw new Error("BufferedUnifyStore is closed")
	}

	private publishCommittedChange(): void {
		this.subscriptionState.generation += 1
		const change = { generation: this.subscriptionState.generation }
		for (const listener of this.subscriptionState.listeners) {
			void Promise.resolve(listener(change)).catch(() => undefined)
		}
	}
}

function getSubscriptionState(key: string): SubscriptionState {
	let state = subscriptions.get(key)
	if (!state) {
		state = { generation: 0, listeners: new Set() }
		subscriptions.set(key, state)
	}
	return state
}

function findBaselineTimestamp<TItem extends { ts: number }>(
	items: readonly TItem[],
	baseline: ReadonlySet<number>,
	fromIndex: number,
	direction: -1 | 1,
): number | undefined {
	for (let index = fromIndex + direction; index >= 0 && index < items.length; index += direction) {
		if (baseline.has(items[index].ts)) return items[index].ts
	}
	return undefined
}

function isDefined<TValue>(value: TValue | undefined): value is TValue {
	return value !== undefined
}
