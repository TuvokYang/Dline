import { type ClineAsk, type ClineMessage, type ClineSay } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import pWaitFor from "p-wait-for"
import type { ClineMessageModelInfo } from "@/shared/messages"
import type { MessageStateHandler } from "./message-state"
import type { TaskState } from "./TaskState"

const ABORT_ALLOWED_SAY_TYPES = new Set<ClineSay>(["hook_status", "hook_output_stream", "deleted_api_reqs", "state_snapshot"])

/**
 * Check whether a say message is required for abort-time lifecycle cleanup.
 *
 * @param type Say message type being emitted.
 * @returns True when the message may be persisted after task abort.
 */
export function isAbortAllowedSay(type: ClineSay): boolean {
	return ABORT_ALLOWED_SAY_TYPES.has(type)
}

// ── Types ──

export interface AskOptions {
	onAskVisible?: (askTs: number) => Promise<void> | void
	existingTs?: number
	onTsCreated?: (ts: number) => void
	commandTs?: number
}

export interface AskResult {
	response: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
	askTs?: number
}

export interface MessageChannelConfig {
	pushMessage: (msg: ClineMessage) => void
	syncState: () => Promise<void>
	messageStateHandler: MessageStateHandler
	taskState: TaskState
	getProviderInfo: () => ClineMessageModelInfo
	genTs: () => number
}

// ── MessageChannel ──

/**
 * Standalone message engine extracted from Task.say/ask.
 * Handles message formatting, persistence (memory + jsonl),
 * gRPC push via injected callbacks, and ask response waiting.
 *
 * Does NOT depend on Task or Controller — only on injected config.
 */
export class MessageChannel {
	private pushMessage: (msg: ClineMessage) => void
	private syncState: () => Promise<void>
	private messageStateHandler: MessageStateHandler
	private taskState: TaskState
	private getProviderInfo: () => ClineMessageModelInfo
	private genTs: () => number

	constructor(config: MessageChannelConfig) {
		this.pushMessage = config.pushMessage
		this.syncState = config.syncState
		this.messageStateHandler = config.messageStateHandler
		this.taskState = config.taskState
		this.getProviderInfo = config.getProviderInfo
		this.genTs = config.genTs
	}

	// ── Helpers ──

	private async postStateToWebview(): Promise<void> {
		await this.syncState()
	}

	private shouldMessageInvalidateAsk(message: ClineMessage): boolean {
		if (message.type === "say" && message.say === "state_snapshot") {
			return false
		}

		if (message.type === "say" && message.say === "user_feedback" && this.taskState.askResponse !== undefined) {
			return false
		}

		return true
	}

	private isAskPromiseSuperseded(invalidationStartIndex: number): boolean {
		const messages = this.messageStateHandler.clineMessages
		for (let i = invalidationStartIndex; i < messages.length; i++) {
			if (this.shouldMessageInvalidateAsk(messages[i])) {
				return true
			}
		}
		return false
	}

	// ── say ──

	/**
	 * Add or update a "say" message in the chat.
	 * Signature matches Task.say exactly.
	 */
	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		existingTs?: number,
		commandTs?: number,
	): Promise<number | undefined> {
		// Allow lifecycle messages during abort so cancel/resume state can be persisted.
		if (this.taskState.abort && !isAbortAllowedSay(type)) {
			throw new Error("Dline instance aborted")
		}

		const modelInfo = this.getProviderInfo()

		// partial === true: memory-only upsert, no jsonl, no postState
		if (partial === true) {
			const ts = existingTs ?? this.genTs()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const msg = { ts, type: "say" as const, say: type, text, images, files, partial: true, modelInfo, commandTs }
			const upserted = await this.messageStateHandler.upsertClineMessageInMemory(msg)
			this.pushMessage(upserted)
			this.taskState.lastMessageTs = ts
			return ts
		}

		// partial === false: finalize — same ts replace memory → persist jsonl
		if (partial === false) {
			const ts = existingTs ?? this.genTs()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const msg: any = { ts, type: "say", say: type, text, images, files, modelInfo, commandTs }
			// Preserve commandStatus for command messages
			if (type === "command") {
				const existing = existingTs ? this.messageStateHandler.clineMessages.find((m) => m.ts === existingTs) : undefined
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const existingStatus = (existing as ClineMessage)?.commandStatus
				msg.commandStatus = existingStatus || "pending"
			}
			const finalized = await this.messageStateHandler.finalizeClineMessage(msg)
			this.pushMessage(finalized)
			await this.postStateToWebview()
			this.taskState.lastMessageTs = ts
			return ts
		}

		// partial === undefined: normal message, add + persist + postState
		const ts = this.genTs()
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const msg: any = { ts, type: "say", say: type, text, images, files, modelInfo, commandTs }
		if (type === "command") {
			msg.commandStatus = "pending"
		}
		await this.messageStateHandler.addToClineMessages(msg)
		await this.postStateToWebview()
		this.pushMessage(msg)
		this.taskState.lastMessageTs = ts
		return ts
	}

	// ── ask ──

	/** Persist one ask presentation without creating a legacy response waiter. */
	async presentAsk(type: ClineAsk, text?: string, existingTs?: number): Promise<number> {
		const askTs = existingTs ?? this.genTs()
		this.taskState.lastMessageTs = askTs
		const messages = this.messageStateHandler.clineMessages
		const index = messages.findIndex((message) => message.ts === askTs)
		if (index >= 0) {
			await this.messageStateHandler.updateClineMessage(index, { type: "ask", ask: type, text, partial: false })
		} else {
			await this.messageStateHandler.addToClineMessages({ ts: askTs, type: "ask", ask: type, text })
		}
		await this.postStateToWebview()
		const persisted = this.messageStateHandler.clineMessages.find((message) => message.ts === askTs)
		if (persisted) {
			this.pushMessage(persisted)
		}
		return askTs
	}

	/**
	 * Send an "ask" message and wait for user response.
	 * Signature matches Task.ask exactly.
	 */
	async ask(type: ClineAsk, text?: string, partial?: boolean, options?: AskOptions): Promise<AskResult> {
		// Allow resume asks even when aborted
		if (this.taskState.abort && type !== "resume_task" && type !== "resume_completed_task") {
			throw new Error("Dline instance aborted")
		}

		let didNotifyAskVisible = false
		const notifyAskVisible = async (askTs: number) => {
			if (!options?.onAskVisible || didNotifyAskVisible) {
				return
			}
			didNotifyAskVisible = true
			await options.onAskVisible(askTs)
		}

		let askTs: number
		let invalidationStartIndex = 0
		if (partial !== undefined) {
			askTs = options?.existingTs ?? this.genTs()

			if (partial) {
				const upserted = await this.messageStateHandler.upsertClineMessageInMemory({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
					partial: true,
					commandTs: options?.commandTs,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
				} as Partial<ClineMessage>)
				this.pushMessage(upserted)
				this.taskState.lastMessageTs = askTs
				options?.onTsCreated?.(askTs)
				await notifyAskVisible(askTs)
				throw new Error("Current ask promise was ignored 1")
			}

			// partial=false: finalize
			this.taskState.lastMessageTs = askTs
			const finalized = await this.messageStateHandler.finalizeClineMessage({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
				commandTs: options?.commandTs,
				commandStatus: type === "command" ? "pending" : undefined,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as Partial<ClineMessage>)
			this.pushMessage(finalized)
			await this.postStateToWebview()
			options?.onTsCreated?.(askTs)
			await notifyAskVisible(askTs)
			invalidationStartIndex = this.messageStateHandler.clineMessages.length
		} else {
			// Non-partial ask
			askTs = options?.existingTs ?? this.genTs()
			this.taskState.lastMessageTs = askTs
			if (options?.existingTs !== undefined) {
				const msgs = this.messageStateHandler.clineMessages
				const idx = msgs.findIndex((m) => m.ts === options?.existingTs)
				if (idx !== -1) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const updates: Partial<ClineMessage> = { partial: false }
					if (type === "command" && !msgs[idx].commandStatus) {
						updates.commandStatus = "pending"
					}
					if (text !== undefined) {
						updates.text = text
					}
					await this.messageStateHandler.updateClineMessage(idx, updates)
				} else {
					await this.messageStateHandler.addToClineMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						partial: false,
						commandTs: options?.commandTs,
						commandStatus: type === "command" ? "pending" : undefined,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} as Partial<ClineMessage>)
				}
			} else {
				await this.messageStateHandler.addToClineMessages({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
					commandTs: options?.commandTs,
					commandStatus: type === "command" ? "pending" : undefined,
				})
			}
			await this.postStateToWebview()
			const msgs = this.messageStateHandler.clineMessages
			this.pushMessage(msgs[msgs.length - 1])
			await notifyAskVisible(askTs)
			invalidationStartIndex = this.messageStateHandler.clineMessages.length
		}

		// Clear previous response state
		this.taskState.askResponse = undefined
		this.taskState.askResponseText = undefined
		this.taskState.askResponseImages = undefined
		this.taskState.askResponseFiles = undefined

		// Notification hook handled by Task.ask() wrapper

		// Wait for response
		const shouldWakeOnAbort = type !== "resume_task" && type !== "resume_completed_task"
		await pWaitFor(
			() =>
				this.taskState.askResponse !== undefined ||
				this.isAskPromiseSuperseded(invalidationStartIndex) ||
				(shouldWakeOnAbort && this.taskState.abort),
			{ interval: 100 },
		)
		if (shouldWakeOnAbort && this.taskState.abort && this.taskState.askResponse === undefined) {
			throw new Error("Dline instance aborted")
		}
		if (this.taskState.askResponse === undefined && this.isAskPromiseSuperseded(invalidationStartIndex)) {
			throw new Error("Current ask promise was ignored")
		}

		const result: AskResult = {
			response: this.taskState.askResponse!,
			text: this.taskState.askResponseText,
			images: this.taskState.askResponseImages,
			files: this.taskState.askResponseFiles,
		}
		this.taskState.askResponse = undefined
		this.taskState.askResponseText = undefined
		this.taskState.askResponseImages = undefined
		this.taskState.askResponseFiles = undefined
		return result
	}

	// ── resolve ──

	/**
	 * Resolve a pending ask with the webview's response.
	 * Called by handleWebviewAskResponse → this resolves the Promise in ask().
	 */
	resolve(response: ClineAskResponse, text?: string, images?: string[], files?: string[]): void {
		this.taskState.askResponse = response
		this.taskState.askResponseText = text
		this.taskState.askResponseImages = images
		this.taskState.askResponseFiles = files
	}
}
