import type { ClineAsk } from "@shared/ExtensionMessage"

// ── Types ──

/** Input block for buildTurn — minimal shape accepted from Task. */
export interface TurnBlockInput {
	type?: string
	call_id?: string
	name?: string
	ts?: number
	conversationHistoryIndex?: number
}

/**
 * Per-block lifecycle phase.
 */
export enum BlockPhase {
	STREAMING = "streaming",
	AWAITING_APPROVAL = "awaiting_approval",
	EXECUTING = "executing",
	AUTO_EXECUTING = "auto_executing",
	COMPLETED = "completed",
	REJECTED = "rejected",
	SKIPPED = "skipped",
}

/**
 * Lifecycle state for a single tool-use block within a turn.
 */
export interface BlockLifecycle {
	callId: string
	toolName: string
	phase: BlockPhase
	ts: number
	requiresApproval: boolean
	conversationHistoryIndex: number
}

/**
 * Event emitted when a block phase changes.
 */
export interface BlockEvent {
	type: "noop" | "auto-execute" | "awaiting-approval" | "waiting-for-token" | "execute" | "rejected" | "completed"
	callId: string
	toolName?: string
	askType?: ClineAsk
}

/**
 * Result of acquiring the approval token.
 */
interface TokenResult {
	granted: boolean
	mustWait: boolean
}

// ── BlockPhaseMachine ──

/**
 * Manages per-block lifecycle phases and the approval token.
 * Extracted from TaskController to keep the controller lean.
 */
export class BlockPhaseMachine {
	private turnBlocks: BlockLifecycle[] = []
	private activeTokenCallId: string | null = null
	private turnBuilt = false

	// ── Turn Building ──

	/**
	 * Build the turn from tool_use blocks.
	 * Must be called once per assistant turn before any advance() calls.
	 */
	buildTurn(blocks: TurnBlockInput[], autoApprove: (toolName: string, callId: string) => boolean): void {
		this.turnBlocks = []
		this.activeTokenCallId = null
		this.turnBuilt = true

		for (const block of blocks) {
			if (block.type !== "tool_use") continue

			const callId = block.call_id || ""
			const toolName = block.name || ""
			const ts = block.ts ?? Date.now()
			const conversationHistoryIndex = block.conversationHistoryIndex ?? 0

			this.turnBlocks.push({
				callId,
				toolName,
				phase: BlockPhase.STREAMING,
				ts,
				requiresApproval: !autoApprove(toolName, callId),
				conversationHistoryIndex,
			})
		}
	}

	// ── Approval Token ──

	acquireToken(callId: string): TokenResult {
		const block = this.findBlock(callId)
		if (!block) return { granted: false, mustWait: false }

		if (!block.requiresApproval) {
			return { granted: true, mustWait: false }
		}

		if (this.activeTokenCallId === callId) {
			return { granted: true, mustWait: false }
		}

		if (this.activeTokenCallId === null) {
			this.activeTokenCallId = callId
			return { granted: true, mustWait: false }
		}

		return { granted: false, mustWait: true }
	}

	/**
	 * Check if a block phase is terminal (no further transitions possible).
	 */
	private isTerminalPhase(phase: BlockPhase): boolean {
		return (
			phase === BlockPhase.COMPLETED ||
			phase === BlockPhase.REJECTED ||
			phase === BlockPhase.SKIPPED ||
			phase === BlockPhase.EXECUTING ||
			phase === BlockPhase.AWAITING_APPROVAL
		)
	}

	releaseToken(): BlockLifecycle | null {
		this.activeTokenCallId = null

		for (const block of this.turnBlocks) {
			if (block.requiresApproval && !this.isTerminalPhase(block.phase)) {
				this.activeTokenCallId = block.callId
				block.phase = BlockPhase.AWAITING_APPROVAL
				return block
			}
		}

		return null
	}

	// ── Phase State Machine ──

	/**
	 * Advance a block to its next phase.
	 */
	advance(callId: string, blockReady: boolean): BlockEvent {
		const block = this.findBlock(callId)
		if (!block) return { type: "noop", callId }

		switch (block.phase) {
			case BlockPhase.STREAMING: {
				if (!blockReady) return { type: "noop", callId }

				if (!block.requiresApproval) {
					block.phase = BlockPhase.AUTO_EXECUTING
					return { type: "auto-execute", callId, toolName: block.toolName }
				}

				const token = this.acquireToken(callId)
				if (token.granted) {
					block.phase = BlockPhase.AWAITING_APPROVAL
					return {
						type: "awaiting-approval",
						callId,
						toolName: block.toolName,
					}
				}

				return { type: "waiting-for-token", callId, toolName: block.toolName }
			}

			case BlockPhase.AWAITING_APPROVAL: {
				return { type: "noop", callId }
			}

			case BlockPhase.EXECUTING:
			case BlockPhase.AUTO_EXECUTING: {
				block.phase = BlockPhase.COMPLETED
				if (block.requiresApproval) {
					this.releaseToken()
				}
				return { type: "completed", callId, toolName: block.toolName }
			}

			case BlockPhase.COMPLETED:
			case BlockPhase.REJECTED:
			case BlockPhase.SKIPPED:
				return { type: "noop", callId }

			default:
				return { type: "noop", callId }
		}
	}

	// ── Active Block Management ──

	completeActiveBlock(): BlockLifecycle | null {
		if (!this.activeTokenCallId) return null
		const block = this.findBlock(this.activeTokenCallId)
		if (!block) return null
		block.phase = BlockPhase.EXECUTING
		return block
	}

	rejectActiveBlock(): BlockLifecycle | null {
		if (!this.activeTokenCallId) return null

		const block = this.findBlock(this.activeTokenCallId)
		if (!block) return null

		block.phase = BlockPhase.REJECTED

		// Cascade SKIPPED
		let found = false
		for (const b of this.turnBlocks) {
			if (b.callId === block.callId) {
				found = true
				continue
			}
			if (found && b.requiresApproval) {
				b.phase = BlockPhase.SKIPPED
			}
		}

		this.activeTokenCallId = null
		return block
	}

	advanceNextPendingApproval(): BlockLifecycle | null {
		for (const b of this.turnBlocks) {
			if (b.phase === BlockPhase.STREAMING && b.requiresApproval) {
				this.advance(b.callId, true)
				return this.findBlock(b.callId) ?? null
			}
		}

		return this.getActiveBlock()
	}

	getBlocks(): BlockLifecycle[] {
		return this.turnBlocks.map((block) => ({ ...block }))
	}

	restoreTurn(
		blocks: Array<{
			callId: string
			toolName: string
			phase: BlockPhase
			conversationHistoryIndex: number
			ts?: number
			requiresApproval?: boolean
		}>,
		activeCallId?: string,
	): void {
		this.turnBlocks = blocks.map((block) => ({
			callId: block.callId,
			toolName: block.toolName,
			phase: block.phase,
			ts: block.ts ?? Date.now(),
			requiresApproval: block.requiresApproval ?? true,
			conversationHistoryIndex: block.conversationHistoryIndex,
		}))
		this.activeTokenCallId =
			activeCallId ?? this.turnBlocks.find((block) => block.phase === BlockPhase.AWAITING_APPROVAL)?.callId ?? null
		this.turnBuilt = true
	}

	// ── State Queries ──

	getActiveBlock(): BlockLifecycle | null {
		return this.turnBlocks.find((b) => b.phase === BlockPhase.AWAITING_APPROVAL) ?? null
	}

	wasRejected(callId: string): boolean {
		const block = this.findBlock(callId)
		return block?.phase === BlockPhase.REJECTED
	}

	shouldSkip(callId: string): boolean {
		const block = this.findBlock(callId)
		return block?.phase === BlockPhase.SKIPPED
	}

	getPhase(callId: string): BlockPhase | null {
		return this.findBlock(callId)?.phase ?? null
	}

	hasAnyRejection(): boolean {
		return this.turnBlocks.some((b) => b.phase === BlockPhase.REJECTED)
	}

	get isTurnComplete(): boolean {
		return this.turnBlocks.every(
			(b) => b.phase === BlockPhase.COMPLETED || b.phase === BlockPhase.REJECTED || b.phase === BlockPhase.SKIPPED,
		)
	}

	reset(): void {
		this.turnBlocks = []
		this.activeTokenCallId = null
		this.turnBuilt = false
	}

	// ── Two-Phase Execution ──

	getReadyBlocks(): BlockLifecycle[] {
		return this.turnBlocks.filter((b) => b.phase === BlockPhase.AUTO_EXECUTING || b.phase === BlockPhase.EXECUTING)
	}

	async executeAll(readyBlocks: BlockLifecycle[], executor: (callId: string) => Promise<void>): Promise<void> {
		await Promise.all(readyBlocks.map((block) => executor(block.callId)))
	}

	// ── Helpers ──

	private findBlock(callId: string): BlockLifecycle | undefined {
		return this.turnBlocks.find((b) => b.callId === callId)
	}

	/**
	 * Map a tool name to the ClineAsk type used for approval UI.
	 */
	static toolNameToAskType(toolName: string): ClineAsk {
		switch (toolName) {
			case "execute_command":
				return "command"
			case "spawn_task":
				return "spawn_task"
			case "write_to_file":
			case "replace_in_file":
				return "tool"
			case "browser_action":
				return "browser_action_launch"
			case "use_mcp_tool":
			case "access_mcp_resource":
				return "use_mcp_server"
			case "use_subagents":
				return "use_subagents"
			case "focus_chain_change":
				return "focus_chain_change"
			default:
				return "tool"
		}
	}
}
