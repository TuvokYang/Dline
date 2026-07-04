import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { EventEmitter } from "events"
import getFolderSize from "get-folder-size"
import { findLastIndex } from "@/shared/array"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { HistoryItem } from "@/shared/HistoryItem"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ApiConversation } from "../storage/ApiConversation"
import { ensureTaskDirectoryExists, getTaskHeaderText } from "../storage/disk"
import { UIMessage } from "../storage/UIMessage"
import { TaskState } from "./TaskState"

// Event types for clineMessages changes
export type ClineMessageChangeType = "add" | "update" | "delete" | "set"

export interface ClineMessageChange {
	type: ClineMessageChangeType
	/** The full array after the change */
	messages: ClineMessage[]
	/** The affected index (for add/update/delete) */
	index?: number
	/** The new/updated message (for add/update) */
	message?: ClineMessage
	/** The old message before change (for update/delete) */
	previousMessage?: ClineMessage
	/** The entire previous array (for set) */
	previousMessages?: ClineMessage[]
}

// Strongly-typed event emitter interface
export interface MessageStateHandlerEvents {
	clineMessagesChanged: [change: ClineMessageChange]
}

interface MessageStateHandlerParams {
	taskId: string
	ulid: string
	taskIsFavorited?: boolean
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	taskState: TaskState
	checkpointManagerErrorMessage?: string
	/** UI messages store — optional for tests (memory-only mode). */
	uiMessage?: UIMessage
	/** API conversation store — optional for tests. */
	apiConversation?: ApiConversation
}

/**
 * Coordinates message state across UIMessage and ApiConversation stores.
 *
 * All data persistence is delegated to UIMessage / ApiConversation,
 * which themselves delegate to JsonlIndexedStore (with built-in Mutex + FileLock).
 * This class focuses on cross-store coordination and event emission.
 */
export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private _updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState

	/** UI messages (clineMessages) — single source of truth for ui_messages.jsonl */
	public readonly uiMessage: UIMessage | undefined

	/** API conversation history — single source of truth for api_conversation_history.jsonl */
	public readonly apiConversation: ApiConversation | undefined

	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this._updateTaskHistory = params.updateTaskHistory
		this.uiMessage = params.uiMessage
		this.apiConversation = params.apiConversation
	}

	// ── ClineMessages (read from UIMessage store) ──

	/** ClineMessages as a property getter — reads directly from uiMessage store. */
	get clineMessages(): ClineMessage[] {
		return this.uiMessage ? (this.uiMessage.getAll() as unknown as ClineMessage[]) : []
	}

	set clineMessages(msgs: ClineMessage[]) {
		if (!this.uiMessage) return
		this.uiMessage.overwrite(msgs).catch((e) => Logger.error("set clineMessages failed:", e))
	}

	/** ApiConversationHistory as a property getter — reads directly from apiConversation store. */
	get apiConversationHistory(): ClineStorageMessage[] {
		return this.apiConversation ? (this.apiConversation.getAll() as unknown as ClineStorageMessage[]) : []
	}

	set apiConversationHistory(msgs: ClineStorageMessage[]) {
		if (!this.apiConversation) return
		this.apiConversation.overwrite(msgs).catch((e) => Logger.error("set apiConversationHistory failed:", e))
	}

	// ── Event emission ──

	/**
	 * Emit a clineMessagesChanged event with the change details
	 */
	private emitClineMessagesChanged(change: ClineMessageChange): void {
		this.emit("clineMessagesChanged", change)
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

	reloadFromStore(): void {
		const uiMsg = this.uiMessage
		if (!uiMsg) return
		uiMsg
			.reload()
			.then(() => {
				this.emitClineMessagesChanged({
					type: "set",
					messages: [...uiMsg.getAll()],
					previousMessages: [],
				})
			})
			.catch((e) => Logger.error("reloadFromStore failed:", e))
	}

	// ── Task history metadata ──

	/**
	 * Compute and update task history metadata without touching message files.
	 * Used by incremental add paths that handle file I/O separately.
	 */
	private async updateTaskHistoryOnly(): Promise<void> {
		try {
			const allMessages = this.clineMessages
			const persisted = allMessages.filter((m) => !m.partial)
			if (persisted.length === 0) return
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(allMessages.slice(1))))
			const taskText = await getTaskHeaderText(this.taskId)
			const lastRelevantIndex = findLastIndex(
				persisted,
				(message) => !(message.ask === "resume_task" || message.ask === "resume_completed_task"),
			)
			const lastRelevantMessage = lastRelevantIndex >= 0 ? persisted[lastRelevantIndex] : persisted[persisted.length - 1]
			const apiHistory = this.apiConversationHistory
			const lastModelInfo = [...apiHistory].reverse().find((msg) => msg.modelInfo !== undefined)
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			let taskDirSize = 0
			try {
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				Logger.error("Failed to get task directory size:", taskDir, error)
			}
			const cwd = await getCwd(getDesktopDir())
			// Use _updateTaskHistory (constructor-injected callback), NOT this.updateTaskHistory
			await this._updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskText,
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				currency: apiMetrics.currency || "",
				size: taskDirSize,
				shadowGitConfigWorkTree: await this.checkpointTracker?.getShadowGitConfigWorkTree(),
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
				modelId: lastModelInfo?.modelInfo?.modelId,
				providerId: lastModelInfo?.modelInfo?.providerId,
				mode: lastModelInfo?.modelInfo?.mode,
			})
		} catch (error) {
			Logger.error("Failed to update task history:", error)
		}
	}

	async updateTaskHistory(): Promise<void> {
		await this.updateTaskHistoryOnly()
	}

	// ── API conversation history ──

	/**
	 * Add a message to the API conversation history.
	 * Delegates to ApiConversation.addMessage (auto-ts, cache + disk).
	 */
	async addToApiConversationHistory(message: ClineStorageMessage): Promise<void> {
		return await this.apiConversation?.addMessage(message)
	}

	/**
	 * Replace the entire API conversation history using clear + incremental add.
	 * Each message is added individually to leverage append's memory+markDirty path.
	 */
	async overwriteApiConversationHistory(newHistory: ClineStorageMessage[]): Promise<void> {
		await this.apiConversation?.clear()
		for (const msg of newHistory) {
			await this.apiConversation?.addMessage(msg)
		}
	}

	/**
	 * Force flush the API conversation history to disk immediately.
	 * Used in hook cancellation paths where state must be persisted before abort.
	 */
	async flushApiConversationHistory(): Promise<void> {
		await this.apiConversation?.flush()
	}

	/**
	 * Force flush UI messages to disk immediately.
	 * Used in hook cancellation paths where state must be persisted before abort.
	 */
	async flushUiMessages(): Promise<void> {
		await this.uiMessage?.flush()
	}

	// ── ClineMessages lifecycle ──

	/**
	 * Add a new message to clineMessages.
	 * Handles partial vs complete messages, coordinates with API conversation history,
	 * and emits change events.
	 */
	async addToClineMessages(message: Partial<ClineMessage>): Promise<void> {
		if (message.ts === undefined) {
			throw new Error("addToClineMessages: ts is required")
		}
		const msg = message as ClineMessage
		if (msg.partial === true) {
			// Partial messages stay memory-only — upsert without disk write
			await this.upsertClineMessageInMemory(message)
			return
		}

		// Set cross-store context before persisting
		msg.conversationHistoryIndex = this.apiConversationHistory.length - 1
		msg.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange

		// Persist via UIMessage store (cache + disk, Mutex-protected)
		await this.uiMessage?.addMessage(msg)
		const index = (this.uiMessage?.count ?? 0) - 1

		this.emitClineMessagesChanged({
			type: "add",
			messages: this.clineMessages,
			index,
			message: msg,
		})

		await this.updateTaskHistoryOnly()
	}

	/**
	 * Upsert a message in memory only — no disk write.
	 */
	async upsertClineMessageInMemory(message: Partial<ClineMessage>): Promise<ClineMessage> {
		if (message.ts === undefined) {
			throw new Error("upsertClineMessageInMemory: ts is required")
		}
		const msg = message as ClineMessage
		const all = this.clineMessages
		const existingIndex = all.findIndex((m) => m.ts === msg.ts)

		if (existingIndex >= 0) {
			const previousMessage = { ...all[existingIndex] }
			msg.conversationHistoryIndex = all[existingIndex].conversationHistoryIndex
			msg.conversationHistoryDeletedRange = all[existingIndex].conversationHistoryDeletedRange

			// Use UIMessage API for in-memory upsert (no disk write for partial)
			this.uiMessage?.upsertMessage(msg)
			// The store's internal array is updated — re-read for fresh state
			const freshAll = this.clineMessages

			this.emitClineMessagesChanged({
				type: "update",
				messages: freshAll,
				index: existingIndex,
				previousMessage,
				message: freshAll[existingIndex],
			})

			return freshAll[existingIndex]
		}

		msg.conversationHistoryIndex = this.apiConversationHistory.length - 1
		msg.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange

		// Find insertion point in ascending ts order
		let insertIndex = all.length
		for (let i = 0; i < all.length; i++) {
			if (all[i].ts > msg.ts) {
				insertIndex = i
				break
			}
		}

		// For memory-only upsert, we need to insert into the store's internal array.
		// UIMessage.upsertMessage returns the index but doesn't modify the store.
		// We use insertAt for persistence; for memory-only, we signal via event.
		// Note: true persistence happens when partial transitions to false.
		this.emitClineMessagesChanged({
			type: "add",
			messages: this.clineMessages,
			index: insertIndex,
			message: msg,
		})

		return msg
	}

	/**
	 * Finalize a partial message — persist to disk.
	 */
	async finalizeClineMessage(message: Partial<ClineMessage>): Promise<ClineMessage> {
		if (message.ts === undefined) {
			throw new Error("finalizeClineMessage: ts is required")
		}
		const msg = message as ClineMessage
		const all = this.clineMessages
		const existingIndex = all.findIndex((m) => m.ts === msg.ts)

		if (existingIndex >= 0) {
			msg.conversationHistoryIndex = all[existingIndex].conversationHistoryIndex
			msg.conversationHistoryDeletedRange = all[existingIndex].conversationHistoryDeletedRange
		} else {
			msg.conversationHistoryIndex = this.apiConversationHistory.length - 1
			msg.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
		}

		msg.partial = false

		// Idempotency guard
		const existing = existingIndex >= 0 ? all[existingIndex] : null
		const alreadyFinalized =
			existing !== null &&
			existing.partial === false &&
			existing.type === msg.type &&
			existing.say === msg.say &&
			existing.ask === msg.ask &&
			existing.text === msg.text
		if (alreadyFinalized) {
			return all[existingIndex]
		}

		// Persist via store
		await this.uiMessage?.finalizeMessage(msg)

		const freshAll = this.clineMessages
		const freshIndex = freshAll.findIndex((m) => m.ts === msg.ts)

		if (freshIndex >= 0) {
			const previousMessage = { ...all[existingIndex >= 0 ? existingIndex : 0] }
			this.emitClineMessagesChanged({
				type: "update",
				messages: freshAll,
				index: freshIndex,
				previousMessage,
				message: freshAll[freshIndex],
			})
		} else {
			this.emitClineMessagesChanged({
				type: "add",
				messages: freshAll,
				index: freshAll.length - 1,
				message: msg,
			})
		}

		await this.updateTaskHistoryOnly()
		return msg
	}

	/**
	 * Flush a single message to disk.
	 */
	async flushMessageUpdate(index: number): Promise<void> {
		await this.uiMessage?.flushMessage(index)
		await this.updateTaskHistoryOnly()
	}

	/**
	 * Flush multiple messages to disk.
	 */
	async flushMessageUpdates(indices: number[]): Promise<void> {
		await this.uiMessage?.flushMessages(indices)
		await this.updateTaskHistoryOnly()
	}

	/**
	 * Update a specific message in the clineMessages array (in-memory only).
	 */
	async updateClineMessage(index: number, updates: Partial<ClineMessage>): Promise<void> {
		const all = this.clineMessages
		if (index < 0 || index >= all.length) {
			throw new Error(`Invalid message index: ${index}`)
		}
		const previousMessage = { ...all[index] }
		this.uiMessage?.updateMessage(index, updates)

		const freshAll = this.clineMessages
		this.emitClineMessagesChanged({
			type: "update",
			messages: freshAll,
			index,
			previousMessage,
			message: freshAll[index],
		})
	}

	/**
	 * Delete a specific message from the clineMessages array.
	 */
	async deleteClineMessage(index: number): Promise<void> {
		const all = this.clineMessages
		if (index < 0 || index >= all.length) {
			throw new Error(`Invalid message index: ${index}`)
		}
		const previousMessage = all[index]
		await this.uiMessage?.deleteMessage(index)

		const freshAll = this.clineMessages
		this.emitClineMessagesChanged({
			type: "delete",
			messages: freshAll,
			index,
			previousMessage,
		})
		await this.updateTaskHistoryOnly()
	}

	/**
	 * Remove messages by their timestamps.
	 */
	async removeMessagesByTs(tsList: number[]): Promise<void> {
		if (tsList.length === 0) return
		const previousMessages = [...this.clineMessages]
		await this.uiMessage?.removeByTs(tsList)
		const freshAll = this.clineMessages
		const removed = previousMessages.length - freshAll.length
		if (removed === 0) return
		Logger.debug(`[removeMessagesByTs] removed=${removed}`)
		this.emitClineMessagesChanged({
			type: "set",
			messages: freshAll,
			previousMessages,
		})
		await this.updateTaskHistoryOnly()
	}

	/**
	 * Remove all partial messages from clineMessages.
	 */
	async removePartialMessages(): Promise<void> {
		const all = this.clineMessages
		const partialMessages = all.filter((m) => m.partial === true)
		if (partialMessages.length === 0) return

		Logger.debug(
			`[removePartialMessages] total=${all.length}, partial=${partialMessages.length}` +
				partialMessages.map((m) => ` [ts=${m.ts} type=${m.type} say=${m.say}]`).join(""),
		)

		const previousMessages = [...all]
		await this.uiMessage?.removePartialMessages()

		this.emitClineMessagesChanged({
			type: "set",
			messages: this.clineMessages,
			previousMessages,
		})

		await this.updateTaskHistoryOnly()
	}
}
