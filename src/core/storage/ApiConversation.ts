import path from "path"
import { ClineStorageMessage } from "@/shared/messages/content"
import { normalizeLegacyConversation } from "@/shared/messages/legacy-identity-migration"
import { ensureTaskDirectoryExists, GlobalFileNames } from "./disk"
import { JsonlIndexedStore } from "./JsonlIndexedStore"

/** ClineStorageMessage with guaranteed ts for JsonlIndexedStore indexing. */
type IndexedApiMessage = ClineStorageMessage & { ts: number }

/**
 * API conversation history store backed by api_conversation_history.jsonl.
 *
 * Wraps JsonlIndexedStore<IndexedApiMessage> and provides task-scoped
 * business-level methods.  All write operations are protected by
 * JsonlIndexedStore's internal Mutex + FileLock.
 */
export class ApiConversation {
	private store: JsonlIndexedStore<IndexedApiMessage>

	private constructor(store: JsonlIndexedStore<IndexedApiMessage>) {
		this.store = store
	}

	/** Open (or create) the api_conversation_history.jsonl for a given task. */
	static async open(taskId: string): Promise<ApiConversation> {
		const dir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(dir, GlobalFileNames.apiConversationHistory)
		const store = await JsonlIndexedStore.open<IndexedApiMessage>(filePath)
		const stored = store.getAll()
		const normalized = normalizeLegacyConversation(stored) as IndexedApiMessage[]
		if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
			await store.overwrite(normalized)
		}
		return new ApiConversation(store)
	}

	// ── Read ──
	getAll(): ReadonlyArray<IndexedApiMessage> {
		return this.store.getAll()
	}
	getByTs(ts: number): IndexedApiMessage | undefined {
		return this.store.getByTs(ts)
	}
	getAt(index: number): IndexedApiMessage | undefined {
		return this.store.getAt(index)
	}
	findIndexByTs(ts: number): number {
		return this.store.findIndexByTs(ts)
	}
	get count(): number {
		return this.store.count
	}

	/**
	 * Return the last (most recent) entry, or undefined if empty.
	 * Useful for retrieving modelInfo from the most recent message.
	 */
	getLast(): IndexedApiMessage | undefined {
		const all = this.store.getAll()
		return all.length > 0 ? all[all.length - 1] : undefined
	}

	// ── Write ──

	/**
	 * Append a message with automatic ts assignment.
	 * If the message lacks a ts, it is assigned Date.now().
	 */
	async addMessage(msg: ClineStorageMessage): Promise<void> {
		const ts = msg.ts === undefined || msg.ts === null ? Date.now() : msg.ts
		await this.store.append({ ...msg, ts } as IndexedApiMessage)
	}

	/**
	 * Truncate the store, keeping only entries with ts < beforeTs.
	 */
	async truncate(beforeTs: number): Promise<void> {
		await this.store.truncate(beforeTs)
	}

	/**
	 * Truncate by virtual row count.  Keeps the first `count` rows.
	 */
	async truncateByLineNum(count: number): Promise<void> {
		await this.store.truncateByLineNum(count)
	}

	/**
	 * Clear all entries.
	 */
	async clear(): Promise<void> {
		await this.store.clear()
	}

	/** Force flush any pending dirty data to disk (cross-process safe). */
	async flush(): Promise<void> {
		await this.store.flush()
	}

	/**
	 * ⚠️ DANGEROUS: Overwrite all messages via a cross-process transaction.
	 * Auto-assigns ts for entries that lack it.
	 * Prefer incremental operations (addMessage/truncate) when possible.
	 */
	async overwrite(messages: ClineStorageMessage[]): Promise<void> {
		const indexed = messages.map((m) => {
			const ts = m.ts === undefined || m.ts === null ? Date.now() : m.ts
			return { ...m, ts } as IndexedApiMessage
		})
		await this.store.overwrite(indexed)
	}

	/**
	 * Insert a message at the given position.
	 */
	async insertAt(index: number, msg: ClineStorageMessage): Promise<void> {
		if (msg.ts === undefined || msg.ts === null) {
			;(msg as unknown as Record<string, unknown>).ts = Date.now()
		}
		await this.store.insertAt(index, msg as IndexedApiMessage)
	}

	/**
	 * Update a message at the given position.
	 */
	async updateAt(index: number, msg: ClineStorageMessage): Promise<void> {
		if (msg.ts === undefined || msg.ts === null) {
			;(msg as unknown as Record<string, unknown>).ts = Date.now()
		}
		await this.store.updateAt(index, msg as IndexedApiMessage)
	}

	/**
	 * Delete a message at the given position.
	 */
	async deleteAt(index: number): Promise<void> {
		await this.store.deleteAt(index)
	}
}
