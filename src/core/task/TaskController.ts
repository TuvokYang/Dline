import type { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { BlockPhaseMachine } from "./BlockPhaseMachine"
import type { BlockLifecycle, BlockEvent, TurnBlockInput } from "./BlockPhaseMachine"
import { MessageChannel } from "./MessageChannel"
import type { AskOptions, AskResult } from "./MessageChannel"
import { TaskPhaseMachine } from "./TaskPhaseMachine"
import type { TransitionContext } from "./TaskPhaseMachine"
import { TaskPhase } from "./TaskPhase"
import type { TaskSnapshot } from "./TaskSnapshot"
import type { ToolExecutor } from "./ToolExecutor"
import type { FocusChainManager } from "./focus-chain"

// Re-export types for backward compatibility
export { BlockPhase } from "./BlockPhaseMachine"
export type { BlockLifecycle, BlockEvent }

/**
 * Callback signature for say() — used by releaseApprovalLock to flush buffered
 * partial_tool_result messages.
 */
export type SayCallback = (
	type: ClineSay,
	text?: string,
	images?: string[],
	files?: string[],
	partial?: boolean,
	existingTs?: number,
) => Promise<number | undefined>

/**
 * Central controller for the Task.
 *
 * Responsibilities:
 * - Message engine (via MessageChannel)
 * - Tool execution dispatch (via ToolExecutor)
 * - Approval state machine (via BlockPhaseMachine)
 * - Task lifecycle phases (via TaskPhaseMachine)
 * - Holds and coordinates all sub-components
 */
export class TaskController {
	// ── Sub-modules ──

	readonly channel: MessageChannel
	readonly blockPhase: BlockPhaseMachine
	readonly taskPhase: TaskPhaseMachine

	// ── Sub-components (injected after construction) ──

	private _toolExecutor?: ToolExecutor
	private _focusChainManager?: FocusChainManager

	constructor(channel: MessageChannel) {
		this.channel = channel
		this.blockPhase = new BlockPhaseMachine()
		this.taskPhase = new TaskPhaseMachine()
	}

	// ── Sub-component injection ──

	setToolExecutor(executor: ToolExecutor): void {
		this._toolExecutor = executor
	}

	get toolExecutor(): ToolExecutor | undefined {
		return this._toolExecutor
	}

	setFocusChainManager(manager: FocusChainManager): void {
		this._focusChainManager = manager
	}

	get focusChainManager(): FocusChainManager | undefined {
		return this._focusChainManager
	}

	// ── Message API (delegates to MessageChannel) ──

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		existingTs?: number,
		commandTs?: number,
	): Promise<number | undefined> {
		return this.channel.say(type, text, images, files, partial, existingTs, commandTs)
	}

	async ask(type: ClineAsk, text?: string, partial?: boolean, options?: AskOptions): Promise<AskResult> {
		return this.channel.ask(type, text, partial, options)
	}

	resolveAsk(response: ClineAskResponse, text?: string, images?: string[], files?: string[]): void {
		this.channel.resolve(response, text, images, files)
	}

	// ── Block Phase API (delegates to BlockPhaseMachine) ──

	buildTurn(blocks: TurnBlockInput[], autoApprove: (toolName: string, callId: string) => boolean): void {
		this.blockPhase.buildTurn(blocks, autoApprove)
	}

	advance(callId: string, blockReady: boolean): BlockEvent {
		return this.blockPhase.advance(callId, blockReady)
	}

	completeActiveBlock(): BlockLifecycle | null {
		return this.blockPhase.completeActiveBlock()
	}

	rejectActiveBlock(): BlockLifecycle | null {
		return this.blockPhase.rejectActiveBlock()
	}

	advanceNextPendingApproval(): BlockLifecycle | null {
		return this.blockPhase.advanceNextPendingApproval()
	}

	getBlocks(): BlockLifecycle[] {
		return this.blockPhase.getBlocks()
	}

	restoreTurnFromSnapshot(
		blocks: Array<{
			callId: string
			toolName: string
			phase: BlockLifecycle["phase"]
			conversationHistoryIndex: number
			ts?: number
			requiresApproval?: boolean
		}>,
		activeCallId?: string,
	): void {
		this.blockPhase.restoreTurn(blocks, activeCallId)
	}

	getReadyBlocks(): BlockLifecycle[] {
		return this.blockPhase.getReadyBlocks()
	}

	async executeAll(readyBlocks: BlockLifecycle[], executor: (callId: string) => Promise<void>): Promise<void> {
		return this.blockPhase.executeAll(readyBlocks, executor)
	}

	getActiveBlock(): BlockLifecycle | null {
		return this.blockPhase.getActiveBlock()
	}

	wasRejected(callId: string): boolean {
		return this.blockPhase.wasRejected(callId)
	}

	shouldSkip(callId: string): boolean {
		return this.blockPhase.shouldSkip(callId)
	}

	getPhase(callId: string): ReturnType<BlockPhaseMachine["getPhase"]> {
		return this.blockPhase.getPhase(callId)
	}

	hasAnyRejection(): boolean {
		return this.blockPhase.hasAnyRejection()
	}

	get isTurnComplete(): boolean {
		return this.blockPhase.isTurnComplete
	}

	reset(): void {
		this.blockPhase.reset()
	}

	static toolNameToAskType(toolName: string): ClineAsk {
		return BlockPhaseMachine.toolNameToAskType(toolName)
	}

	/** Instance method for backward compatibility — delegates to static. */
	toolNameToAskType(toolName: string): ClineAsk {
		return TaskController.toolNameToAskType(toolName)
	}

	// ── Task Phase API (delegates to TaskPhaseMachine) ──

	get phase(): TaskPhase {
		return this.taskPhase.phase
	}

	snapshot(apiIndex: number, extra?: Partial<TaskSnapshot>): TaskSnapshot {
		return this.taskPhase.snapshot(apiIndex, extra)
	}

	transition(to: TaskPhase, ctx: TransitionContext): TaskSnapshot {
		return this.taskPhase.transition(to, ctx)
	}

	restoreFrom(snapshot: TaskSnapshot): void {
		this.taskPhase.restoreFrom(snapshot)
	}
}
