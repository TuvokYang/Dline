import { findLastIndex } from "@shared/array"
import type { ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@/shared/messages"

interface CanonicalStoredToolUse extends ClineAssistantToolUseBlock {
	item_id: string
	function_id: string
	dline_tid: string
}

import { isTurnEndingToolName } from "./assistant-message-order"
import type { MessageStateHandler } from "./message-state"
import type { PendingToolUseState, RestoreHandler } from "./RestoreHandler"
import type { TaskController } from "./TaskController"
import { isValidApiIndex, type TaskSnapshot } from "./TaskSnapshot"
import type { TaskState } from "./TaskState"

// ── Types ──

/** Cached approval response for tools resumed from history. */
export interface PendingApprovalResponse {
	type: ClineAsk
	response: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
}

export interface ResumeContext {
	taskState: TaskState
	controller: TaskController
	messageStateHandler: MessageStateHandler
	restoreHandler: RestoreHandler
	/** Returns the latest snapshot from snapshot.json, with legacy UI fallback owned by Task. */
	getLatestSnapshot?: () => TaskSnapshot | undefined
	/** Callback to store a pending approval response for later use. */
	setPendingApprovalResponse?: (resp: PendingApprovalResponse) => void
	ask: (
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		options?: { existingTs?: number },
	) => Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>
	say: (type: ClineSay, text?: string) => Promise<number | undefined>
	postStateToWebview: () => Promise<void>
}

// ── ResumeHandler ──

/**
 * Handles task resumption from history.
 *
 * Responsibilities:
 * - Detect pending tool_use blocks in apiConversationHistory
 * - Prompt user whether to resume pending tools
 * - Coordinate with RestoreHandler for replay
 * - Clean up stale ask messages
 */
export class ResumeHandler {
	constructor(private ctx: ResumeContext) {}

	// ── Helpers ──

	/**
	 * Find the latest task snapshot.
	 * Prefer snapshot.json through the injected provider, then fall back to legacy
	 * state_snapshot UI messages for old tasks.
	 */
	private findLatestSnapshot(): TaskSnapshot | undefined {
		const snapshot = this.ctx.getLatestSnapshot?.()
		if (snapshot) return snapshot

		const msgs = this.ctx.messageStateHandler.clineMessages
		let latest: { snapshot: TaskSnapshot; order: number; timestamp: number } | undefined

		for (let i = 0; i < msgs.length; i++) {
			const m = msgs[i]
			if (m.type === "say" && m.say === "state_snapshot" && m.text) {
				try {
					const snapshot = JSON.parse(m.text) as TaskSnapshot
					const timestamp = typeof snapshot.timestamp === "number" ? snapshot.timestamp : m.ts
					if (!latest || timestamp > latest.timestamp || (timestamp === latest.timestamp && i > latest.order)) {
						latest = { snapshot, order: i, timestamp }
					}
				} catch {
					// Skip corrupt snapshots
				}
			}
		}
		return latest?.snapshot
	}

	private getSnapshotSearchStartIndex(snap: TaskSnapshot | undefined, apiHistoryLength: number): number {
		if (!snap) return apiHistoryLength - 1

		if (isValidApiIndex(snap.resume?.assistantApiIndex, apiHistoryLength)) {
			return snap.resume.assistantApiIndex
		}

		if (snap.approval?.activeCallId) {
			const activeBlock = snap.approval.blocks.find((block) => block.callId === snap.approval?.activeCallId)
			if (isValidApiIndex(activeBlock?.apiIndex, apiHistoryLength)) {
				return activeBlock.apiIndex
			}
		}

		const firstValidApprovalBlock = snap.approval?.blocks.find((block) => isValidApiIndex(block.apiIndex, apiHistoryLength))
		if (firstValidApprovalBlock) {
			return firstValidApprovalBlock.apiIndex
		}

		if (isValidApiIndex(snap.apiIndex, apiHistoryLength)) {
			return snap.apiIndex
		}

		return apiHistoryLength - 1
	}

	// ── Detection ──

	/**
	 * Detect pending (unanswered) tool_use blocks in apiConversationHistory.
	 * Uses state_snapshot when available to filter out rejected/skipped blocks.
	 * Falls back to legacy detection for old tasks without snapshots.
	 *
	 * Also merges partial_tool_result records from clineMessages.
	 */
	detectPendingTools(apiHistory: ClineStorageMessage[]): PendingToolUseState | undefined {
		if (apiHistory.length === 0) return undefined

		// Try snapshot-based rejection filtering first
		const snap = this.findLatestSnapshot()
		const rejectedCallIds = new Set<string>()
		const snapshotPendingIds = snap?.resume?.pendingToolUseIds
			? new Set(snap.resume.pendingToolUseIds.filter((id) => typeof id === "string"))
			: undefined
		const snapshotAnsweredIds = new Set((snap?.resume?.answeredToolUseIds ?? []).filter((id) => typeof id === "string"))
		if (snap?.approval?.blocks) {
			for (const block of snap.approval.blocks) {
				if (block.phase === "rejected" || block.phase === "skipped") {
					if (!block.dlineTid) {
						throw new Error(`Canonical approval snapshot is missing dlineTid: tool=${block.name}`)
					}
					rejectedCallIds.add(block.dlineTid)
				}
			}
		}

		// Collect partial_tool_result records keyed by conversationHistoryIndex
		const partialResultsByIndex = new Map<number, Map<string, string>>()
		for (const m of this.ctx.messageStateHandler.clineMessages) {
			if (m.say === "partial_tool_result" && m.text && m.conversationHistoryIndex !== undefined) {
				try {
					const parsed = JSON.parse(m.text)
					if (parsed.tool_use_id && parsed.result) {
						const idx = m.conversationHistoryIndex
						if (!partialResultsByIndex.has(idx)) {
							partialResultsByIndex.set(idx, new Map())
						}
						partialResultsByIndex.get(idx)?.set(parsed.tool_use_id, parsed.result)
					}
				} catch {
					// Skip malformed records
				}
			}
		}

		const searchStartIndex = this.getSnapshotSearchStartIndex(snap, apiHistory.length)

		for (let i = searchStartIndex; i >= 0; i--) {
			const message = apiHistory[i]
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue

			const toolUseBlocks = message.content.filter(
				(block): block is CanonicalStoredToolUse =>
					block.type === "tool_use" &&
					typeof block.name === "string" &&
					typeof block.item_id === "string" &&
					typeof block.function_id === "string" &&
					typeof block.dline_tid === "string",
			)
			if (toolUseBlocks.length === 0) continue

			const nextMessage = apiHistory[i + 1]
			const answeredToolUseIds = new Set<string>()
			const answeredToolResults: ClineUserToolResultContentBlock[] = []
			if (nextMessage?.role === "user" && Array.isArray(nextMessage.content)) {
				for (const block of nextMessage.content) {
					if (
						block.type === "tool_result" &&
						typeof block.function_id === "string" &&
						typeof block.item_id === "string" &&
						typeof block.dline_tid === "string"
					) {
						answeredToolUseIds.add(block.function_id)
						answeredToolResults.push(block)
					}
				}
			}

			// Merge partial_tool_result records
			const turnPartialResults = partialResultsByIndex.get(i)
			for (const block of toolUseBlocks) {
				if (!answeredToolUseIds.has(block.function_id) && turnPartialResults) {
					const resultText = turnPartialResults.get(block.function_id)
					if (resultText) {
						answeredToolUseIds.add(block.function_id)
						answeredToolResults.push({
							type: "tool_result",
							tool_use_id: block.function_id,
							call_id: block.function_id,
							item_id: `partial_${block.item_id}`,
							function_id: block.function_id,
							dline_tid: block.dline_tid,
							content: [{ type: "text", text: resultText }],
						})
					}
				}
			}

			// Filter out rejected/skipped blocks from snapshot, plus already answered ones
			const pendingToolUseBlocks = toolUseBlocks.filter(
				(block) =>
					(!snapshotPendingIds || snapshotPendingIds.has(block.function_id)) &&
					!answeredToolUseIds.has(block.function_id) &&
					!snapshotAnsweredIds.has(block.function_id) &&
					!isTurnEndingToolName(block.name) &&
					!rejectedCallIds.has(block.dline_tid),
			)
			if (pendingToolUseBlocks.length === 0) return undefined

			return {
				assistantIndex: i,
				toolUseBlocks: pendingToolUseBlocks,
				answeredToolResults,
				sanitizedHistory: apiHistory.slice(0, i + 1),
			}
		}

		return undefined
	}

	// ── Prompt ──

	/**
	 * Find the latest visible ask message for the resumed approval type.
	 * @param askType Ask type that should be restored.
	 * @returns Original ask message when present.
	 */
	private findApprovalAsk(askType: ClineAsk): ClineMessage | undefined {
		const messages = this.ctx.messageStateHandler.clineMessages
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]
			if (message.type === "ask" && message.ask === askType) {
				return message
			}
		}
		return undefined
	}

	/**
	 * Prompt user whether to resume pending tools.
	 * Returns user response and calls rejectActiveBlock on rejection.
	 */
	async promptUser(
		pending: PendingToolUseState,
		lastMsg?: ClineMessage,
	): Promise<{
		response: string
		text?: string
		images?: string[]
		files?: string[]
	}> {
		const askType = this.ctx.controller.toolNameToAskType(pending.toolUseBlocks[0]?.name ?? "")
		const approvalAsk = askType !== "resume_task" ? this.findApprovalAsk(askType) : undefined
		const askText = askType !== "resume_task" ? (lastMsg?.text ?? approvalAsk?.text) : undefined
		const askOptions = approvalAsk ? { existingTs: approvalAsk.ts } : undefined

		const result = await this.ctx.ask(askType, askText, undefined, askOptions)

		// Note: rejectActiveBlock() is intentionally NOT called here because
		// the BlockPhaseMachine has no active approval block during resume
		// (buildTurn initializes all blocks in STREAMING phase).
		// The caller (resumeFromHistory) handles rejection by checking response.

		return result
	}

	// ── Full resume flow ──

	// ── Stale ask cleanup ──

	/**
	 * Remove stale tool approval ask messages from clineMessages.
	 * Mirrors the legacy removeStalePendingToolResumeAsks() logic.
	 */
	private removeStalePendingAsks(): void {
		const pendingToolAskTypes = new Set<ClineAsk>([
			"followup",
			"plan_mode_respond",
			"act_mode_respond",
			"command",
			"tool",
			"browser_action_launch",
			"use_mcp_server",
			"new_task",
			"condense",
			"summarize_task",
			"report_bug",
			"use_subagents",
			"spawn_task",
		])
		const clineMessages = this.ctx.messageStateHandler.clineMessages
		const staleAskIndices = new Set<number>()

		const stalePendingToolAskIndex = findLastIndex(
			clineMessages,
			(message) =>
				message.type === "ask" &&
				!!message.ask &&
				pendingToolAskTypes.has(message.ask) &&
				!(message as any).commandStatus,
		)
		if (stalePendingToolAskIndex !== -1) {
			staleAskIndices.add(stalePendingToolAskIndex)
		}

		const staleApiFailureAskIndex = findLastIndex(
			clineMessages,
			(message) => message.type === "ask" && message.ask === "api_req_failed",
		)
		if (staleApiFailureAskIndex !== -1) {
			staleAskIndices.add(staleApiFailureAskIndex)
		}

		if (staleAskIndices.size > 0) {
			const staleTs = [...staleAskIndices].sort((a, b) => a - b).map((index) => clineMessages[index].ts)
			// Delegate removal — the ctx needs access to uiMessage.removeByTs
			this.ctx.messageStateHandler.removeMessagesByTs(staleTs).catch(() => {})
		}
	}

	// ── Full resume flow ──

	/**
	 * Main resume entry point.
	 * Detects pending tools, prompts user, and replays if approved.
	 * Also cleans stale asks and caches approval responses for later use.
	 * @returns true if pending tools were found and handled
	 */
	async resumeFromHistory(lastMsg?: ClineMessage): Promise<boolean> {
		const apiHistory = this.ctx.messageStateHandler.apiConversationHistory
		const pending = this.detectPendingTools(apiHistory)

		if (!pending) return false

		const response = await this.promptUser(pending, lastMsg)
		if (response.response === "noButtonClicked") return false

		// Cache approval response if we have a specific tool ask type (not generic resume_task)
		const askType = this.ctx.controller.toolNameToAskType(pending.toolUseBlocks[0]?.name ?? "")
		if (askType !== "resume_task" && this.ctx.setPendingApprovalResponse) {
			this.ctx.setPendingApprovalResponse({
				type: askType,
				response: response.response as ClineAskResponse,
				text: response.text,
				images: response.images,
				files: response.files,
			})
		}

		// Clean up stale ask messages from the previous interrupted session
		this.removeStalePendingAsks()

		await this.ctx.restoreHandler.replayPendingTools(pending)
		return true
	}
}
