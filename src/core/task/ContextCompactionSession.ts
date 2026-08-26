import type { ApiHandler } from "@core/api"
import type { CanonicalMessageRange } from "@core/context/context-management/compaction-context-projection"
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
import type { ProviderRequestRoundAdmission, ProviderRequestRoundPort } from "@core/task/performance/provider-request-round-port"
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

/** Stable, non-secret transition state owned by the transition workflow. */
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
	/** Stable owning Task identity for provider-side prompt cache isolation. */
	taskNamespace?: string
	compactionApi: ApiHandler
	targetApi: ApiHandler
	targetMode: Mode
	sourceHistory: ClineStorageMessage[]
	/** Canonical API range represented by each source message; synthetic boundary messages are undefined. */
	sourceCanonicalRanges?: Array<CanonicalMessageRange | undefined>
	/** Complete assistant/tool messages excluded from compaction but retained by final canonical commit. */
	targetContinuationHistory?: ClineStorageMessage[]
	/** Pending user/draft content used only for target projection until the ordinary request is admitted. */
	targetContinuationContent?: ClineContent[]
	/** Trigger-owned guidance included in a Pass request but excluded from target projection and canonical commit. */
	passGuidance?: ClineContent[]
	/** Original unsent ordinary input retained by the trigger while compaction is in flight. */
	ordinaryInput?: ClineContent[]
	/** Preserve the ordinary request's context-loading boundary during every target reprojection. */
	includeFileDetails?: boolean
	didSwitchFromPlan?: boolean
	transition?: ContextCompactionTransitionState
	signal?: AbortSignal
}

export interface ContextCompactionPassRequest {
	providerInput: CompactionProviderInput
	explicitInstructions: ExplicitInstructionRequestScope
	initialAttemptId: string
}

export type ContextCompactionPassReview = { action: "accept" } | { action: "regenerate"; feedback: ClineContent[] }

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

export type ContextCompactionSessionEvent =
	| {
			kind: "pass_started"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			providerInput: CompactionProviderInput
	  }
	| {
			kind: "pass_receiving"
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			chunk: unknown
	  }
	| {
			kind: "pass_partial"
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			content: string
	  }
	| {
			kind: "pass_retry"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			providerInput: CompactionProviderInput
			event: ContextCompactionPassRetryEvent
	  }
	| {
			kind: "pass_completed"
			state: TargetWindowFittingState
			passIdentity: ReturnType<typeof getCompactionPassIdentity>
			attempt: InternalCompactionAttemptIdentity
			projection: ContextCompactionReprojection
			content: string
	  }
	| { kind: "failed"; state?: TargetWindowFittingState; error: string }

export interface ContextCompactionSessionPorts {
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
	reprojectTarget(input: ContextCompactionSessionInput, state: TargetWindowFittingState): Promise<ContextCompactionReprojection>
	stageAcceptedPass(
		input: ContextCompactionSessionInput,
		state: TargetWindowFittingState,
		projection: ContextCompactionReprojection,
	): Promise<void>
	commit(input: ContextCompactionSessionInput, state: TargetWindowFittingState): Promise<void>
	publish(input: ContextCompactionSessionInput, event: ContextCompactionSessionEvent): Promise<void>
	waitForRetry(input: ContextCompactionSessionInput, retryAttempt: number, signal: AbortSignal): Promise<void>
	recordUsage?(usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }): void
	providerRequestRounds?: ProviderRequestRoundPort
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
			settled,
			settle: () => settleActive?.(),
		}
		const signal = combineSignals(input.signal, abortController.signal)
		let state = tryStartTargetWindowFitting(
			indexLogicalTurns(cloneDeep(input.sourceHistory)),
			input.operationId,
			input.sourceCanonicalRanges,
		)
		if (!state) {
			const reason = "No complete logical turn is available for context compaction."
			await this.ports.publish(input, { kind: "failed", error: reason })
			this.active.settle()
			this.active = undefined
			return "failed"
		}
		this.active.state = cloneDeep(state)

		try {
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
						providerInput: request.providerInput,
					})
					let projection: ContextCompactionReprojection | undefined
					try {
						while (true) {
							const providerRequestRound = this.ports.providerRequestRounds?.admit({ source: "compaction" })
							const automaticReplayAllowed = !isManualTrigger(input.trigger)
							const retryPolicy = new CompactionRetryPolicy(
								automaticReplayAllowed ? this.options.maxRetryAttempts : 0,
							)
							const result = await runInternalCompactionPassWithRetry({
								api: input.compactionApi,
								providerInput: request.providerInput,
								explicitInstructions: request.explicitInstructions,
								taskNamespace: input.taskNamespace,
								providerRequestRound,
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
										providerInput: request.providerInput,
										event,
									})
								},
								onChunk: async (chunk, attempt) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.publish(input, {
										kind: "pass_receiving",
										passIdentity,
										attempt,
										chunk: cloneDeep(chunk),
									})
								},
								onSummaryUpdate: async (content, attempt) => {
									this.assertCurrent(input.operationId, signal)
									await this.ports.publish(input, {
										kind: "pass_partial",
										passIdentity,
										attempt,
										content,
									})
								},
							})
							this.completeProviderExecution(result, providerRequestRound)
							this.assertCurrent(input.operationId, signal)
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

							const nextState = acceptCompactionPass(state, result.summary).state
							projection = await this.ports.reprojectTarget(input, cloneDeep(nextState))
							this.assertCurrent(input.operationId, signal)
							await this.ports.stageAcceptedPass(input, nextState, projection)
							this.assertCurrent(input.operationId, signal)
							state = nextState
							if (this.active?.operationId === input.operationId) this.active.state = cloneDeep(state)
							await this.ports.publish(input, {
								kind: "pass_completed",
								state: cloneDeep(state),
								passIdentity,
								attempt: completedAttempt,
								projection,
								content: result.summary,
							})
							this.recordAcceptedPassUsage(result)
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
						return "completed"
					}
					if (decision.status === "exhausted") {
						throw new Error(
							`Context compaction could not fit the complete target request below the required 80% exit target of ${decision.fittingExitTarget} tokens for the effective context limit ${decision.effectiveContextLimit}, because no complete logical turn remains.`,
						)
					}
				} catch (error) {
					if (signal.aborted) throw signal.reason ?? error
					throw error
				}
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			await this.ports.publish(input, { kind: "failed", state: cloneDeep(state), error: reason })
			return signal.aborted ? "cancelled" : "failed"
		} finally {
			const active = this.active?.operationId === input.operationId ? this.active : undefined
			active?.settle()
			if (this.active === active) this.active = undefined
		}
	}

	cancel(operationId: string, reason = "Context compaction cancelled."): void {
		if (this.active?.operationId === operationId && !this.active.abortController.signal.aborted) {
			this.active.abortController.abort(new Error(reason))
			this.active.input.compactionApi.abort?.()
		}
	}

	getActiveOperationId(): string | undefined {
		return this.active?.operationId
	}

	private completeProviderExecution(
		result: Awaited<ReturnType<typeof runInternalCompactionPassWithRetry>>,
		providerRequestRound?: ProviderRequestRoundAdmission,
	): void {
		if (!result.settlement) {
			providerRequestRound?.completeProviderOnly()
			return
		}
		void result.settlement.catch(() => undefined).finally(() => providerRequestRound?.completeProviderOnly())
	}

	private recordAcceptedPassUsage(result: Awaited<ReturnType<typeof runInternalCompactionPassWithRetry>>): void {
		if (!result.settlement) {
			if (result.usage) this.ports.recordUsage?.(result.usage)
			return
		}
		void result.settlement
			.then((settlement) => {
				const usage = settlement.usage ?? result.usage
				if (usage) this.ports.recordUsage?.(usage)
			})
			.catch(() => undefined)
	}

	private assertCurrent(operationId: string, signal: AbortSignal): void {
		if (signal.aborted) throw signal.reason ?? new Error("Context compaction cancelled.")
		if (this.active?.operationId !== operationId) throw new Error("Context compaction operation became stale.")
	}
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
