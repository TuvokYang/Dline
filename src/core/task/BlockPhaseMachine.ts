import type { ClineAsk } from "@shared/ExtensionMessage"

// ── Types ──

/** Input block for buildTurn — minimal shape accepted from Task. */
export interface TurnBlockInput {
	type?: string
	call_id?: string
	dline_tid?: string
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
	CANCELLED = "cancelled",
}

/**
 * Lifecycle state for a single tool-use block within a turn.
 */
export interface BlockLifecycle {
	/** Dline trace identity used as the lifecycle key. */
	dlineTid: string
	/** Provider function identity retained for UI and legacy snapshot compatibility. */
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
	dlineTid: string
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
	private activeTokenDlineTid: string | null = null
	private turnBuilt = false

	// ── Turn Building ──

	/**
	 * Build the turn from tool_use blocks.
	 * Must be called once per assistant turn before any advance() calls.
	 */
	buildTurn(blocks: TurnBlockInput[], autoApprove: (toolName: string, callId: string) => boolean): void {
		this.turnBlocks = []
		this.activeTokenDlineTid = null
		this.turnBuilt = true

		for (const block of blocks) {
			if (block.type !== "tool_use") continue
			if (!block.dline_tid || !block.call_id) {
				throw new Error(`Canonical runtime tool block is missing identity: tool=${block.name || "unknown"}`)
			}

			const dlineTid = block.dline_tid
			const callId = block.call_id
			const toolName = block.name || ""
			const ts = block.ts ?? Date.now()
			const conversationHistoryIndex = block.conversationHistoryIndex ?? 0

			this.turnBlocks.push({
				dlineTid,
				callId,
				toolName,
				phase: BlockPhase.STREAMING,
				ts,
				requiresApproval: !autoApprove(toolName, dlineTid),
				conversationHistoryIndex,
			})
		}
	}

	// ── Approval Token ──

	acquireToken(dlineTid: string): TokenResult {
		const block = this.findBlock(dlineTid)
		if (!block) return { granted: false, mustWait: false }

		if (!block.requiresApproval) {
			return { granted: true, mustWait: false }
		}

		if (this.activeTokenDlineTid === dlineTid) {
			return { granted: true, mustWait: false }
		}

		if (this.activeTokenDlineTid === null) {
			this.activeTokenDlineTid = dlineTid
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
			phase === BlockPhase.CANCELLED ||
			phase === BlockPhase.EXECUTING ||
			phase === BlockPhase.AWAITING_APPROVAL
		)
	}

	/**
	 * Cancel the currently active approval block without marking it rejected.
	 * @returns The cancelled block, or null when no approval token is active.
	 */
	cancelActiveBlock(): BlockLifecycle | null {
		if (!this.activeTokenDlineTid) return null
		const block = this.findBlock(this.activeTokenDlineTid)
		if (!block) return null
		block.phase = BlockPhase.CANCELLED
		this.activeTokenDlineTid = null
		return block
	}

	releaseToken(): BlockLifecycle | null {
		this.activeTokenDlineTid = null

		for (const block of this.turnBlocks) {
			if (block.requiresApproval && !this.isTerminalPhase(block.phase)) {
				this.activeTokenDlineTid = block.dlineTid
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
	advance(dlineTid: string, blockReady: boolean): BlockEvent {
		const block = this.findBlock(dlineTid)
		if (!block) return { type: "noop", dlineTid, callId: dlineTid }

		switch (block.phase) {
			case BlockPhase.STREAMING: {
				if (!blockReady) return { type: "noop", dlineTid, callId: block.callId }

				if (!block.requiresApproval) {
					block.phase = BlockPhase.AUTO_EXECUTING
					return { type: "auto-execute", dlineTid, callId: block.callId, toolName: block.toolName }
				}

				const token = this.acquireToken(dlineTid)
				if (token.granted) {
					block.phase = BlockPhase.AWAITING_APPROVAL
					return {
						type: "awaiting-approval",
						dlineTid,
						callId: block.callId,
						toolName: block.toolName,
					}
				}

				return { type: "waiting-for-token", dlineTid, callId: block.callId, toolName: block.toolName }
			}

			case BlockPhase.AWAITING_APPROVAL: {
				return { type: "noop", dlineTid, callId: block.callId }
			}

			case BlockPhase.EXECUTING:
			case BlockPhase.AUTO_EXECUTING: {
				block.phase = BlockPhase.COMPLETED
				if (block.requiresApproval) {
					this.releaseToken()
				}
				return { type: "completed", dlineTid, callId: block.callId, toolName: block.toolName }
			}

			case BlockPhase.COMPLETED:
			case BlockPhase.REJECTED:
			case BlockPhase.SKIPPED:
				return { type: "noop", dlineTid, callId: block.callId }

			default:
				return { type: "noop", dlineTid, callId: block.callId }
		}
	}

	// ── Active Block Management ──

	completeActiveBlock(): BlockLifecycle | null {
		if (!this.activeTokenDlineTid) return null
		const block = this.findBlock(this.activeTokenDlineTid)
		if (!block) return null
		block.phase = BlockPhase.EXECUTING
		return block
	}

	rejectActiveBlock(): BlockLifecycle | null {
		if (!this.activeTokenDlineTid) return null

		const block = this.findBlock(this.activeTokenDlineTid)
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

		this.activeTokenDlineTid = null
		return block
	}

	advanceNextPendingApproval(): BlockLifecycle | null {
		for (const b of this.turnBlocks) {
			if (b.phase === BlockPhase.STREAMING && b.requiresApproval) {
				this.advance(b.dlineTid, true)
				return this.findBlock(b.dlineTid) ?? null
			}
		}

		return this.getActiveBlock()
	}

	getBlocks(): BlockLifecycle[] {
		return this.turnBlocks.map((block) => ({ ...block }))
	}

	restoreTurn(
		blocks: Array<{
			dlineTid?: string
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
			dlineTid: block.dlineTid ?? block.callId,
			callId: block.callId,
			toolName: block.toolName,
			phase: block.phase,
			ts: block.ts ?? Date.now(),
			requiresApproval: block.requiresApproval ?? true,
			conversationHistoryIndex: block.conversationHistoryIndex,
		}))
		this.activeTokenDlineTid =
			this.turnBlocks.find((block) => block.callId === activeCallId)?.dlineTid ??
			activeCallId ??
			this.turnBlocks.find((block) => block.phase === BlockPhase.AWAITING_APPROVAL)?.dlineTid ??
			null
		this.turnBuilt = true
	}

	// ── State Queries ──

	getActiveBlock(): BlockLifecycle | null {
		return this.turnBlocks.find((b) => b.phase === BlockPhase.AWAITING_APPROVAL) ?? null
	}

	wasRejected(dlineTid: string): boolean {
		const block = this.findBlock(dlineTid)
		return block?.phase === BlockPhase.REJECTED
	}

	shouldSkip(dlineTid: string): boolean {
		const block = this.findBlock(dlineTid)
		return block?.phase === BlockPhase.SKIPPED
	}

	getPhase(dlineTid: string): BlockPhase | null {
		return this.findBlock(dlineTid)?.phase ?? null
	}

	hasAnyRejection(): boolean {
		return this.turnBlocks.some((b) => b.phase === BlockPhase.REJECTED)
	}

	get isTurnComplete(): boolean {
		return this.turnBlocks.every(
			(b) =>
				b.phase === BlockPhase.COMPLETED ||
				b.phase === BlockPhase.REJECTED ||
				b.phase === BlockPhase.SKIPPED ||
				b.phase === BlockPhase.CANCELLED,
		)
	}

	reset(): void {
		this.turnBlocks = []
		this.activeTokenDlineTid = null
		this.turnBuilt = false
	}

	// ── Two-Phase Execution ──

	getReadyBlocks(): BlockLifecycle[] {
		return this.turnBlocks.filter((b) => b.phase === BlockPhase.AUTO_EXECUTING || b.phase === BlockPhase.EXECUTING)
	}

	async executeAll(readyBlocks: BlockLifecycle[], executor: (dlineTid: string) => Promise<void>): Promise<void> {
		await Promise.all(readyBlocks.map((block) => executor(block.dlineTid)))
	}

	// ── Helpers ──

	private findBlock(dlineTid: string): BlockLifecycle | undefined {
		return this.turnBlocks.find((b) => b.dlineTid === dlineTid)
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
			case "use_subagent":
			case "use_subagents":
				return "use_subagents"
			case "focus_chain_change":
				return "focus_chain_change"
			case "status_update":
				return "status_acknowledgment"
			default:
				return "tool"
		}
	}
}
