import type { ApiHandler } from "@core/api"
import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import { planNextCompactionPass } from "@core/context/context-management/compaction-pass-planner"
import { CompactionRetryPolicy } from "@core/context/context-management/compaction-retry-policy"
import {
	type InternalCompactionAttemptIdentity,
	type InternalCompactionPassRetryEvent,
	runInternalCompactionPassWithRetry,
} from "@core/context/context-management/internal-compaction-pass"
import { indexLogicalTurns } from "@core/context/context-management/logical-turns"
import type { TargetWindowFittingDecision } from "@core/context/context-management/TargetWindowFittingService"
import {
	acceptCompactionPass,
	applyCompactionPassPlan,
	getCompactionPassIdentity,
	type TargetWindowFittingState,
	tryStartTargetWindowFitting,
} from "@core/context/context-management/target-window-fitting"
import type { CompactionProviderInput } from "@core/task/compaction/CompactionRequestReplay"
import type { ExplicitInstructionRequestScope } from "@core/task/explicit-instructions/ExplicitInstructionRequestScope"
import type { ChatContent } from "@shared/ChatContent"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import cloneDeep from "clone-deep"

export type ContextCompactionTriggerKind =
	| "auto_compaction"
	| "task_header"
	| "manual_compact_command"
	| "profile_switch"
	| "mode_switch"

export type ContextCompactionSessionResult = "completed" | "cancelled" | "failed"

/** Stable, non-secret transition state persisted with compaction checkpoints. */
export interface ContextCompactionTransitionState {
	kind: "profile_switch" | "mode_switch"
	operationId: string
	phase: "compacting"
	source: {
		mode: Mode
		profile?: string
		contextWindow?: number
	}
	sourceProfiles?: Partial<Record<Mode, string>>
	target: {
		mode: Mode
		profile?: string
		contextWindow: number
	}
	targetModes?: Mode[]
	chatContent?: ChatContent
}

export interface ContextCompactionSessionInput {
	operationId: string
	trigger: ContextCompactionTriggerKind
	compactionApi: ApiHandler
	targetApi: ApiHandler
	targetMode: Mode
	sourceHistory: ClineStorageMessage[]
	/** Complete assistant/tool messages excluded from compaction but retained by final canonical commit. */
	targetContinuationHistory?: ClineStorageMessage[]
	/** Pending user/draft content used only for target projection until the ordinary request is admitted. */
	targetContinuationContent?: ClineContent[]
	/** Trigger-owned guidance included in a Pass request but excluded from target projection and canonical commit. */
	passGuidance?: ClineContent[]
	/** Original unsent ordinary input restored from C0 after cancellation or failure. */
	ordinaryInput?: ClineContent[]
	/** Preserve the ordinary request's context-loading boundary during every target reprojection. */
	includeFileDetails?: boolean
	didSwitchFromPlan?: boolean
	transition?: ContextCompactionTransitionState
	signal?: AbortSignal
}

export interface ContextCompactionSessionRestoreState {
	state: TargetWindowFittingState
	checkpointHead: CompactionCheckpointHead
}

export interface ContextCompactionSessionRestoreRequest {
	/** Persist restore_pending before the in-flight Provider request is interrupted. */
	prepare(): Promise<void>
	/** Roll the prepared journal forward after the old attempt has stopped. */
	apply(): Promise<ContextCompactionSessionRestoreState>
}

interface PendingContextCompactionRestore {
	request: ContextCompactionSessionRestoreRequest
	prepared: Promise<void>
	completion: Promise<void>
	resolveCompletion(): void
	rejectCompletion(error: unknown): void
	status: "preparing" | "interrupting"
}

export interface ContextCompactionPassRequest {
	providerInput: CompactionProviderInput
	explicitInstructions: ExplicitInstructionRequestScope
	initialAttemptId: string
}

export type ContextCompactionPassReview =
	| { action: "accept" }
	| { action: "regenerate"; feedback: ClineContent[] }

export type ContextCompactionPassRetryEvent =
	| InternalCompactionPassRetryEvent
	| {
			kind: "manual_regeneration"
			failedAttempt: InternalCompactionAttemptIdentity
			nextAttempt: InternalCompactionAttemptIdentity
			feedback: ClineContent[]
	  }

export interface ContextCompactionIndicatorProjection {
	durableContextTokens: number
	pendingSendTokens: number
	environmentTokens: number
	contextWindow: number
	profileId?: string
	profileName?: string
	mode: Mode
}

export type ContextCompactionReprojection = TargetWindowFittingDecision & {
	indicator?: ContextCompactionIndicatorProjection
}

export interface ContextCompactionAcceptedPassCheckpoint {
	expectedHead: CompactionCheckpointHead
	previousState: TargetWindowFittingState
	nextState: TargetWindowFittingState
	passIdentity: ReturnType<typeof getCompactionPassIdentity>
	attempt: InternalCompactionAttemptIdentity
	summary: string
	passGuidance: ClineContent[]
}

/** Durable child head and the exact target projection materialized into its artifact. */
export interface ContextCompactionAcceptedPassCheckpointResult {
	checkpointHead: CompactionCheckpointHead
	projection: ContextCompactionReprojection
}

export type ContextCompactionSessionEvent =
	| {
			kind: "pass_started"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			checkpointHead: CompactionCheckpointHead
			providerInput: CompactionProviderInput
	  }
	| {
			kind: "pass_receiving"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			checkpointHead: CompactionCheckpointHead
			chunk: unknown
	  }
	| {
			kind: "pass_partial"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			checkpointHead: CompactionCheckpointHead
			content: string
	  }
	| {
			kind: "pass_retry"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			checkpointHead: CompactionCheckpointHead
			providerInput: CompactionProviderInput
			event: ContextCompactionPassRetryEvent
	  }
	| {
			kind: "pass_completed"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			previousCheckpointHead: CompactionCheckpointHead
			checkpointHead: CompactionCheckpointHead
			projection: ContextCompactionReprojection
			content: string
	  }
	| { kind: "failed"; state?: TargetWindowFittingState; error: string }

export interface ContextCompactionSessionPorts {
	prepareRootCheckpoint(
		input: ContextCompactionSessionInput,
		initialState: TargetWindowFittingState,
	): Promise<CompactionCheckpointHead>
	checkpointAcceptedPass(
		input: ContextCompactionSessionInput,
		checkpoint: ContextCompactionAcceptedPassCheckpoint,
	): Promise<ContextCompactionAcceptedPassCheckpointResult>
	getPassInputCeiling(input: ContextCompactionSessionInput): number
	estimatePassInput(input: ContextCompactionSessionInput, passHistory: readonly ClineStorageMessage[]): Promise<number>
	buildPassRequest(
		input: ContextCompactionSessionInput,
		state: TargetWindowFittingState,
		feedback?: readonly ClineContent[],
	): Promise<ContextCompactionPassRequest>
	reviewPass?(
		input: ContextCompactionSessionInput,
		state: TargetWindowFittingState,
		passIdentity: ReturnType<typeof getCompactionPassIdentity>,
		attempt: InternalCompactionAttemptIdentity,
		summary: string,
	): Promise<ContextCompactionPassReview>
	stageAcceptedPass(
		input: ContextCompactionSessionInput,
		state: TargetWindowFittingState,
		checkpointHead: CompactionCheckpointHead,
		projection: ContextCompactionReprojection,
	): Promise<void>
	commit(input: ContextCompactionSessionInput, state: TargetWindowFittingState): Promise<void>
	rollback(input: ContextCompactionSessionInput, state: TargetWindowFittingState | undefined, reason: string): Promise<void>
	publish(input: ContextCompactionSessionInput, event: ContextCompactionSessionEvent): Promise<void>
	waitForRetry(input: ContextCompactionSessionInput, retryAttempt: number, signal: AbortSignal): Promise<void>
	recordUsage?(usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }): void
}

export interface ContextCompactionSessionOptions {
	maxRetryAttempts: number
}

/** Own the complete fitting lifecycle shared by every compaction trigger. */
export class ContextCompactionSession {
	private active?: {
		operationId: string
		abortController: AbortController
		input: ContextCompactionSessionInput
		state?: TargetWindowFittingState
		checkpointHead?: CompactionCheckpointHead
		phase: "running" | "restore_pending" | "awaiting_adoption"
		restoreRequest?: PendingContextCompactionRestore
		wakeRestore?: () => void
		settled: Promise<void>
		settle: () => void
	}

	constructor(
		private readonly ports: ContextCompactionSessionPorts,
		private readonly options: ContextCompactionSessionOptions,
	) {}

	async run(input: ContextCompactionSessionInput): Promise<ContextCompactionSessionResult> {
		if (this.active) return "failed"
		const abortController = new AbortController()
		let settleActive: (() => void) | undefined
		const settled = new Promise<void>((resolve) => {
			settleActive = resolve
		})
		this.active = {
			operationId: input.operationId,
			abortController,
			input,
			phase: "running",
			settled,
			settle: () => settleActive?.(),
		}
		const signal = combineSignals(input.signal, abortController.signal)
		let state = tryStartTargetWindowFitting(indexLogicalTurns(cloneDeep(input.sourceHistory)), input.operationId)
		if (!state) {
			const reason = "No complete logical turn is available for context compaction."
			await this.ports.rollback(input, undefined, reason)
			await this.ports.publish(input, { kind: "failed", error: reason })
			this.active.settle()
			this.active = undefined
			return "failed"
		}
		this.active.state = cloneDeep(state)

		try {
			let checkpointHead = await this.ports.prepareRootCheckpoint(input, cloneDeep(state))
			assertRootCheckpointHead(input.operationId, checkpointHead)
			if (this.active?.operationId === input.operationId) this.active.checkpointHead = cloneDeep(checkpointHead)
			while (true) {
				try {
					this.assertCurrent(input.operationId, signal)
					const planResult = await planNextCompactionPass({
						state,
						passInputCeiling: this.ports.getPassInputCeiling(input),
						estimateInputTokens: (passHistory) => this.ports.estimatePassInput(input, passHistory),
					})
					this.assertCurrent(input.operationId, signal)
					if (planResult.kind === "needs_smaller_input") {
						throw new Error(
							`Logical turn ${planResult.turnIndex} requires ${planResult.estimatedInputTokens} input tokens, exceeding the compaction Pass ceiling ${planResult.passInputCeiling}.`,
						)
					}
					state = applyCompactionPassPlan(state, planResult.plan)
					if (this.active?.operationId === input.operationId) this.active.state = cloneDeep(state)

					let passGuidance = cloneDeep(input.passGuidance ?? [])
					let request = await this.ports.buildPassRequest(input, state, passGuidance)
					this.assertCurrent(input.operationId, signal)
					const passIdentity = getCompactionPassIdentity(state)
					let attemptIndex = 0
					const initialAttempt: InternalCompactionAttemptIdentity = {
						attemptIndex,
						authorizationAttemptId: request.initialAttemptId,
					}
					await this.ports.publish(input, {
						kind: "pass_started",
						state: cloneDeep(state),
						passIdentity,
						attempt: initialAttempt,
						checkpointHead: cloneDeep(checkpointHead),
						providerInput: request.providerInput,
					})
					let projection: ContextCompactionReprojection | undefined
					try {
						while (true) {
							const automaticReplayAllowed = !isManualTrigger(input.trigger)
							const retryPolicy = new CompactionRetryPolicy(
								automaticReplayAllowed ? this.options.maxRetryAttempts : 0,
							)
							const result = await runInternalCompactionPassWithRetry({
								api: input.compactionApi,
								providerInput: request.providerInput,
								explicitInstructions: request.explicitInstructions,
								passIdentity,
								retryPolicy,
								allowOpenAiMaxOutputReplay: automaticReplayAllowed,
								initialAttemptIndex: attemptIndex,
								attemptIdFactory: (candidateAttemptIndex) =>
									candidateAttemptIndex === attemptIndex
										? request.initialAttemptId
										: `fitting:${input.operationId}:${passIdentity.passIndex}:attempt:${candidateAttemptIndex}`,
								waitForRetry: async (retryAttempt) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.waitForRetry(input, retryAttempt, signal)
								},
								onRetry: async (event) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.publish(input, {
										kind: "pass_retry",
										state: cloneDeep(state as TargetWindowFittingState),
										passIdentity,
										checkpointHead: cloneDeep(checkpointHead),
										providerInput: request.providerInput,
										event,
									})
								},
								onChunk: async (chunk, attempt) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.publish(input, {
										kind: "pass_receiving",
										state: cloneDeep(state as TargetWindowFittingState),
										passIdentity,
										attempt,
										checkpointHead: cloneDeep(checkpointHead),
										chunk: cloneDeep(chunk),
									})
								},
								onSummaryUpdate: async (content, attempt) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.publish(input, {
										kind: "pass_partial",
										state: cloneDeep(state as TargetWindowFittingState),
										passIdentity,
										attempt,
										checkpointHead: cloneDeep(checkpointHead),
										content,
									})
								},
							})
							this.assertCurrent(input.operationId, signal)
							this.ports.recordUsage?.(result.usage)
							const completedAttempt: InternalCompactionAttemptIdentity = {
								attemptIndex: result.attemptIndex,
								authorizationAttemptId: result.authorizationAttemptId,
							}
							const review = this.ports.reviewPass
								? await this.ports.reviewPass(input, state, passIdentity, completedAttempt, result.summary)
								: ({ action: "accept" } as const)
							this.assertCurrent(input.operationId, signal)
							if (review.action === "regenerate") {
								request.explicitInstructions.close()
								const nextRequest = await this.ports.buildPassRequest(input, state, review.feedback)
								const nextAttempt: InternalCompactionAttemptIdentity = {
									attemptIndex: result.attemptIndex + 1,
									authorizationAttemptId: nextRequest.initialAttemptId,
								}
								await this.ports.publish(input, {
									kind: "pass_retry",
									state: cloneDeep(state),
									passIdentity,
									checkpointHead: cloneDeep(checkpointHead),
									providerInput: nextRequest.providerInput,
									event: {
										kind: "manual_regeneration",
										failedAttempt: completedAttempt,
										nextAttempt,
										feedback: cloneDeep(review.feedback),
									},
								})
								passGuidance = cloneDeep(review.feedback)
								request = nextRequest
								attemptIndex = nextAttempt.attemptIndex
								continue
							}

							const previousState = state
							const nextState = acceptCompactionPass(previousState, result.summary).state
							const previousCheckpointHead = cloneDeep(checkpointHead)
							const checkpointResult = await this.ports.checkpointAcceptedPass(input, {
								expectedHead: checkpointHead,
								previousState: cloneDeep(previousState),
								nextState: cloneDeep(nextState),
								passIdentity,
								attempt: completedAttempt,
								summary: result.summary,
								passGuidance: cloneDeep(passGuidance),
							})
							this.assertCurrent(input.operationId, signal)
							assertChildCheckpointHead(checkpointHead, checkpointResult.checkpointHead)
							checkpointHead = checkpointResult.checkpointHead
							projection = checkpointResult.projection
							state = nextState
							if (this.active?.operationId === input.operationId) {
								this.active.state = cloneDeep(state)
								this.active.checkpointHead = cloneDeep(checkpointHead)
							}
							await this.ports.stageAcceptedPass(input, state, checkpointHead, projection)
							this.assertCurrent(input.operationId, signal)
							await this.ports.publish(input, {
								kind: "pass_completed",
								state: cloneDeep(state),
								passIdentity,
								attempt: completedAttempt,
								previousCheckpointHead,
								checkpointHead: cloneDeep(checkpointHead),
								projection,
								content: result.summary,
							})
							request.explicitInstructions.close()
							break
						}
					} catch (error) {
						request.explicitInstructions.cancel()
						throw error
					}

					if (!projection) throw new Error("Accepted compaction Pass is missing its target reprojection.")
					const decision = projection
					if (decision.status === "complete") {
						await this.ports.commit(input, state)
						this.assertCurrent(input.operationId, signal)
						if (isTransitionTrigger(input.trigger) && this.active?.operationId === input.operationId) {
							this.active.state = cloneDeep(state)
							this.active.phase = "awaiting_adoption"
						}
						return "completed"
					}
					if (decision.status === "exhausted") {
						throw new Error(
							`Context compaction could not fit the complete target request below ${decision.fittingExitTarget} tokens because no complete logical turn remains.`,
						)
					}
				} catch (error) {
					const restored = await this.handleRestoreInterruption(input.operationId)
					if (!restored) throw error
					state = restored.state
					checkpointHead = restored.checkpointHead
				}
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			await this.ports.rollback(input, state, reason)
			await this.ports.publish(input, { kind: "failed", state: cloneDeep(state), error: reason })
			return signal.aborted ? "cancelled" : "failed"
		} finally {
			const active = this.active?.operationId === input.operationId ? this.active : undefined
			active?.settle()
			if (active?.phase !== "awaiting_adoption" && this.active === active) {
				this.active = undefined
			}
		}
	}

	cancel(operationId: string, reason = "Context compaction cancelled."): void {
		if (this.active?.operationId === operationId && !this.active.abortController.signal.aborted) {
			this.active.abortController.abort(new Error(reason))
			this.active.input.compactionApi.abort?.()
		}
	}

	async restore(operationId: string, request: ContextCompactionSessionRestoreRequest): Promise<void> {
		const active = this.active
		if (!active || active.operationId !== operationId) {
			throw new Error("Context compaction restore requires the matching active operation.")
		}
		if (active.restoreRequest) throw new Error("A context compaction restore is already pending.")

		if (active.phase === "awaiting_adoption") {
			throw new Error("Context compaction restore must wait for transition adoption to finish.")
		}

		let resolveCompletion!: () => void
		let rejectCompletion!: (error: unknown) => void
		const completion = new Promise<void>((resolve, reject) => {
			resolveCompletion = resolve
			rejectCompletion = reject
		})
		const pending: PendingContextCompactionRestore = {
			request,
			prepared: Promise.resolve(),
			completion,
			resolveCompletion,
			rejectCompletion,
			status: "preparing",
		}
		active.restoreRequest = pending
		pending.prepared = request.prepare().then(() => {
			if (this.active !== active || active.restoreRequest !== pending) {
				throw new Error("Context compaction restore became stale while preparing its journal.")
			}
			pending.status = "interrupting"
		})
		try {
			await pending.prepared
			if (active.phase === "running") active.input.compactionApi.abort?.()
			else active.wakeRestore?.()
			await completion
		} catch (error) {
			if (pending.status === "preparing" && active.restoreRequest === pending) {
				active.restoreRequest = undefined
			}
			throw error
		}
	}

	release(operationId: string): void {
		if (this.active?.operationId === operationId && this.active.phase === "awaiting_adoption") {
			this.active = undefined
		}
	}

	async fail(operationId: string, reason: string): Promise<void> {
		const active = this.active
		if (!active || active.operationId !== operationId) return
		if (active.phase === "running") {
			this.cancel(operationId, reason)
			await active.settled
			return
		}
		if (active.phase === "restore_pending") return
		try {
			await this.ports.rollback(active.input, active.state, reason)
			await this.ports.publish(active.input, {
				kind: "failed",
				state: active.state ? cloneDeep(active.state) : undefined,
				error: reason,
			})
		} finally {
			if (this.active === active) this.active = undefined
		}
	}

	getActiveOperationId(): string | undefined {
		return this.active?.operationId
	}

	private async handleRestoreInterruption(operationId: string): Promise<ContextCompactionSessionRestoreState | undefined> {
		const active = this.active
		if (!active || active.operationId !== operationId || !active.restoreRequest) return undefined
		try {
			await active.restoreRequest.prepared
		} catch {
			return undefined
		}

		while (this.active === active) {
			const pending = active.restoreRequest
			if (!pending || pending.status !== "interrupting") {
				active.phase = "restore_pending"
				await new Promise<void>((resolve) => {
					active.wakeRestore = resolve
				})
				active.wakeRestore = undefined
				continue
			}
			try {
				const restored = await pending.request.apply()
				assertRestoreState(operationId, restored)
				active.restoreRequest = undefined
				active.phase = "running"
				active.state = cloneDeep(restored.state)
				active.checkpointHead = cloneDeep(restored.checkpointHead)
				pending.resolveCompletion()
				return restored
			} catch (error) {
				active.restoreRequest = undefined
				active.phase = "restore_pending"
				pending.rejectCompletion(error)
			}
		}
		throw new Error("Context compaction restore became stale before it could complete.")
	}

	private assertCurrent(operationId: string, signal: AbortSignal): void {
		if (signal.aborted) throw signal.reason ?? new Error("Context compaction cancelled.")
		if (this.active?.operationId !== operationId) throw new Error("Context compaction operation became stale.")
		if (this.active.restoreRequest?.status === "interrupting") {
			throw new Error("Context compaction Pass was interrupted for checkpoint restore.")
		}
	}
}

function assertRestoreState(operationId: string, restored: ContextCompactionSessionRestoreState): void {
	if (restored.state.operationId !== operationId || restored.checkpointHead.operationId !== operationId) {
		throw new Error("Restored context compaction state belongs to another operation.")
	}
}

function assertRootCheckpointHead(operationId: string, head: CompactionCheckpointHead): void {
	if (
		head.operationId !== operationId ||
		head.rootCheckpointId !== head.headCheckpointId ||
		head.chainRevision !== 0 ||
		head.sequence !== 0 ||
		head.depth !== 0 ||
		!head.branchId.trim()
	) {
		throw new Error("Compaction C0 checkpoint head is invalid or belongs to another operation.")
	}
}

function assertChildCheckpointHead(previous: CompactionCheckpointHead, next: CompactionCheckpointHead): void {
	if (
		next.operationId !== previous.operationId ||
		next.rootCheckpointId !== previous.rootCheckpointId ||
		next.branchId !== previous.branchId ||
		next.headCheckpointId === previous.headCheckpointId ||
		next.chainRevision !== previous.chainRevision + 1 ||
		next.sequence !== previous.sequence + 1 ||
		next.depth !== previous.depth + 1
	) {
		throw new Error("Accepted Compaction Pass did not advance the durable checkpoint head exactly once.")
	}
}

function isTransitionTrigger(trigger: ContextCompactionTriggerKind): boolean {
	return trigger === "profile_switch" || trigger === "mode_switch"
}

function isManualTrigger(trigger: ContextCompactionTriggerKind): boolean {
	return trigger === "task_header" || trigger === "manual_compact_command"
}

function combineSignals(primary: AbortSignal | undefined, secondary: AbortSignal): AbortSignal {
	if (!primary) return secondary
	if (primary.aborted) return primary
	if (secondary.aborted) return secondary
	const controller = new AbortController()
	const abort = (signal: AbortSignal) => {
		if (!controller.signal.aborted) controller.abort(signal.reason)
	}
	primary.addEventListener("abort", () => abort(primary), { once: true })
	secondary.addEventListener("abort", () => abort(secondary), { once: true })
	return controller.signal
}
