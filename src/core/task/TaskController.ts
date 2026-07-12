import type { ClineAsk, ClineSay, TaskUiAction, TaskUiState } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { BlockEvent, BlockLifecycle, TurnBlockInput } from "./BlockPhaseMachine"
import { BlockPhaseMachine } from "./BlockPhaseMachine"
import type { FocusChainManager } from "./focus-chain"
import type { AskOptions, AskResult } from "./MessageChannel"
import { MessageChannel } from "./MessageChannel"
import { TaskPhase } from "./TaskPhase"
import type { TaskTransitionResult, TransitionContext } from "./TaskPhaseMachine"
import { TaskPhaseMachine } from "./TaskPhaseMachine"
import type { TaskSnapshot } from "./TaskSnapshot"
import type { ToolExecutor } from "./ToolExecutor"

export interface BuildTaskUiStateOptions {
	isTaskWorking?: boolean
	runtimeWorking?: boolean
}

/** Return the accepted snapshot or fail at the invalid call site. */
export function requireTransition(result: TaskTransitionResult): TaskSnapshot {
	if (!result.accepted) {
		throw new Error(`Invalid task phase transition: ${result.error.from} -> ${result.error.to}`)
	}
	return result.snapshot
}

// Re-export types for backward compatibility
export { BlockPhase } from "./BlockPhaseMachine"
export type { BlockEvent, BlockLifecycle }

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

	buildTurn(blocks: TurnBlockInput[], autoApprove: (toolName: string, dlineTid: string) => boolean): void {
		this.blockPhase.buildTurn(blocks, autoApprove)
	}

	advance(dlineTid: string, blockReady: boolean): BlockEvent {
		return this.blockPhase.advance(dlineTid, blockReady)
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
			dlineTid: string
			callId: string
			toolName: string
			phase: BlockLifecycle["phase"]
			conversationHistoryIndex: number
			ts?: number
			requiresApproval?: boolean
		}>,
		activeDlineTid?: string,
	): void {
		this.blockPhase.restoreTurn(blocks, activeDlineTid)
	}

	getReadyBlocks(): BlockLifecycle[] {
		return this.blockPhase.getReadyBlocks()
	}

	async executeAll(readyBlocks: BlockLifecycle[], executor: (dlineTid: string) => Promise<void>): Promise<void> {
		return this.blockPhase.executeAll(readyBlocks, executor)
	}

	getActiveBlock(): BlockLifecycle | null {
		return this.blockPhase.getActiveBlock()
	}

	wasRejected(dlineTid: string): boolean {
		return this.blockPhase.wasRejected(dlineTid)
	}

	shouldSkip(dlineTid: string): boolean {
		return this.blockPhase.shouldSkip(dlineTid)
	}

	getPhase(dlineTid: string): ReturnType<BlockPhaseMachine["getPhase"]> {
		return this.blockPhase.getPhase(dlineTid)
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

	async transition(to: TaskPhase, ctx: TransitionContext): Promise<TaskTransitionResult> {
		return this.taskPhase.transition(to, ctx)
	}

	/** Transition and fail at the exact legacy call site when the edge is invalid. */
	async transitionRequired(to: TaskPhase, ctx: TransitionContext): Promise<TaskSnapshot> {
		return requireTransition(await this.transition(to, ctx))
	}

	restoreFrom(snapshot: TaskSnapshot): void {
		this.taskPhase.restoreFrom(snapshot)
	}

	/**
	 * Build TaskUiState from current snapshot for frontend consumption.
	 * This is the single source of truth for footer buttons and input state.
	 */
	buildTaskUiState(snapshot: TaskSnapshot | null, options: BuildTaskUiStateOptions = {}): TaskUiState {
		const runtimeWorking = options.runtimeWorking ?? false
		const runtimeState: TaskUiState = {
			phase: "working",
			inputEnabled: false,
			cancelEnabled: true,
			showFooter: true,
			actions: [{ type: "cancel", label: "Cancel", enabled: true }],
			reason: "working:runtime",
		}

		if (!snapshot) {
			if (runtimeWorking) {
				return runtimeState
			}
			return {
				phase: "idle",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: false,
				actions: [],
				reason: "no-snapshot",
			}
		}

		const isRuntimeOnlyWorkingPhase =
			snapshot.phase !== TaskPhase.STREAMING &&
			snapshot.phase !== TaskPhase.EXECUTING &&
			snapshot.phase !== TaskPhase.RESUMING
		if (snapshot.phase === TaskPhase.CANCELLING && runtimeWorking) {
			return {
				phase: "cancelled",
				inputEnabled: false,
				cancelEnabled: false,
				showFooter: true,
				actions: [{ type: "cancel", label: "Cancel", enabled: false }],
				reason: "cancelling",
			}
		}

		// Error recovery awaiting must take priority over runtimeWorking so
		// the Retry / Process Anyway button is shown when api_req_failed or
		// mistake_limit_reached has been emitted — otherwise runtimeWorking
		// masks the explicit error-recovery checkpoint.
		if (snapshot.awaiting?.kind === "error_recovery" && snapshot.error) {
			const actions: TaskUiAction[] = snapshot.error.actions.map((actionType) => {
				if (actionType === "retry") {
					return { type: "retry", label: "Retry", enabled: true }
				}
				if (actionType === "process_anyway") {
					return { type: "process_anyway", label: "Process Anyway", enabled: true }
				}
				return { type: "start_new_task", label: "Start New Task", enabled: true }
			})

			return {
				phase: "awaiting_error_recovery",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: true,
				actions,
				activeAsk: snapshot.error.sourceAsk,
				message: snapshot.error.message,
				reason: `error-recovery:${snapshot.error.kind}`,
			}
		}

		if (runtimeWorking && isRuntimeOnlyWorkingPhase) {
			return runtimeState
		}

		// Conversation awaiting (plan_mode_respond, qna_respond, etc.)
		// This explicit checkpoint takes precedence over stale message-derived
		// working inference, but not over an actually running runtime task.
		if (snapshot.awaiting?.kind === "conversation" && !runtimeWorking) {
			if (snapshot.awaiting.taskAsk === "condense") {
				return {
					phase: "awaiting_input",
					inputEnabled: true,
					cancelEnabled: false,
					showFooter: true,
					actions: [{ type: "utility", label: "Condense Conversation", enabled: true }],
					activeAsk: snapshot.awaiting.taskAsk,
					reason: "utility-awaiting:condense",
				}
			}

			return {
				phase: "awaiting_input",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: false,
				actions: [],
				activeAsk: snapshot.awaiting.taskAsk,
				reason: "conversation-awaiting",
			}
		}

		// Completion awaiting
		if (snapshot.awaiting?.kind === "completion") {
			return {
				phase: "completed",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: true,
				actions: [{ type: "start_new_task", label: "Start New Task", enabled: true }],
				activeAsk: snapshot.awaiting.taskAsk,
				reason: "completion-awaiting",
			}
		}
		// Status acknowledgment awaiting (Acknowledge / Stop buttons with input enabled)
		if (snapshot.awaiting?.kind === "approval" && snapshot.awaiting?.taskAsk === "status_acknowledgment") {
			return {
				phase: "awaiting_acknowledgment",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: true,
				actions: [
					{ type: "primary", label: "Acknowledge", enabled: true },
					{ type: "secondary", label: "Stop", enabled: true },
				],
				activeAsk: snapshot.awaiting.taskAsk,
				activeCallId: snapshot.awaiting.activeCallId,
				reason: "status-acknowledgment",
			}
		}

		// Approval awaiting
		if (snapshot.awaiting?.kind === "approval" && snapshot.approval) {
			return {
				phase: "awaiting_approval",
				inputEnabled: false,
				cancelEnabled: false,
				showFooter: true,
				actions: [
					{ type: "approve", label: "Approve", enabled: true },
					{ type: "reject", label: "Reject", enabled: true },
				],
				activeAsk: snapshot.awaiting.taskAsk,
				activeCallId: snapshot.awaiting.activeCallId,
				reason: "approval-awaiting",
			}
		}

		// Completed task resume awaiting should keep the Start New Task affordance.
		if (snapshot.awaiting?.kind === "resume" && snapshot.awaiting.taskAsk === "resume_completed_task") {
			return {
				phase: "completed",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: true,
				actions: [{ type: "start_new_task", label: "Start New Task", enabled: true }],
				activeAsk: snapshot.awaiting.taskAsk,
				reason: "completion-resume-awaiting",
			}
		}

		// Resume awaiting
		if (snapshot.awaiting?.kind === "resume") {
			return {
				phase: "awaiting_resume",
				inputEnabled: false,
				cancelEnabled: false,
				showFooter: true,
				actions: [{ type: "resume", label: "Resume", enabled: true }],
				activeAsk: snapshot.awaiting.taskAsk,
				reason: "resume-awaiting",
			}
		}

		const isWorkingPhase =
			snapshot.phase === TaskPhase.STREAMING ||
			snapshot.phase === TaskPhase.EXECUTING ||
			snapshot.phase === TaskPhase.RESUMING
		const isRecoverableStalePhase =
			isWorkingPhase || snapshot.phase === TaskPhase.CANCELLING || snapshot.phase === TaskPhase.PAUSED
		const isTaskWorking = options.isTaskWorking ?? isWorkingPhase

		if (isRecoverableStalePhase && !isTaskWorking) {
			return {
				phase: "awaiting_resume",
				inputEnabled: true,
				cancelEnabled: false,
				showFooter: true,
				actions: [{ type: "resume", label: "Resume", enabled: true }],
				activeAsk: "resume_task",
				reason: `resume-from-stale-working:${snapshot.phase}`,
			}
		}

		if (snapshot.phase === TaskPhase.CANCELLING) {
			return {
				phase: "cancelled",
				inputEnabled: false,
				cancelEnabled: false,
				showFooter: false,
				actions: [],
				reason: "cancelling",
			}
		}

		// Working (streaming, executing, etc.)
		if (isWorkingPhase && isTaskWorking) {
			return {
				phase: "working",
				inputEnabled: false,
				cancelEnabled: true,
				showFooter: true,
				actions: [{ type: "cancel", label: "Cancel", enabled: true }],
				reason: `working:${snapshot.phase}`,
			}
		}

		// Default idle
		return {
			phase: "idle",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: false,
			actions: [],
			reason: `idle:${snapshot.phase}`,
		}
	}
}
