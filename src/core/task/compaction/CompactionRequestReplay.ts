import { createHash } from "node:crypto"
import { isOutputLimitExceededError } from "@core/api/stream/OutputLimitExceededError"
import type { CompactionPassIdentity } from "@core/context/context-management/target-window-fitting"
import type { ResolvedPromptRuntime } from "@core/prompts/system-prompt-cache/FrozenPromptRuntime"
import type { ClineStorageMessage } from "@shared/messages"
import type { ServerTool } from "@shared/proto/dline/models/metadata"
import type { ClineTool } from "@shared/tools"
import cloneDeep from "clone-deep"
import type { ExplicitInstructionDeclaration } from "../explicit-instructions/types"

export interface CompactionProviderInput {
	systemPrompt: string
	messages: ClineStorageMessage[]
	tools?: ClineTool[]
	readonly serverTools: readonly ServerTool[]
	/** Frozen prompt/tool execution projection for this Provider input. */
	readonly runtime?: ResolvedPromptRuntime
	providerOutputCap?: number
}

export type OpenAiMaxOutputReplayDecision = "not_applicable" | "replay" | "exhausted"

export interface CompactionAttemptIdentity extends CompactionPassIdentity {
	attemptIndex: number
	authorizationAttemptId: string
	inputHash: string
}

interface CompactionReplayState {
	apiIndex: number
	historyIndex: number
	initialConsecutiveMistakeCount: number
	declaration: ExplicitInstructionDeclaration
	passIdentity?: CompactionPassIdentity
	providerInput?: CompactionProviderInput
	inputHash?: string
	currentAttempt?: CompactionAttemptIdentity
	initialProviderOutputCap?: number
	currentProviderOutputCap?: number
	openAiMaxOutputReplayUsed: boolean
}

/** Keeps the canonical provider input for the one active automatic compaction request. */
export class CompactionRequestReplay {
	private state?: CompactionReplayState

	/** Start a new logical compaction request and record its physical API-history boundary. */
	begin(
		apiIndex: number,
		historyIndex: number,
		initialConsecutiveMistakeCount: number,
		declaration: ExplicitInstructionDeclaration,
		passIdentity?: CompactionPassIdentity,
	): void {
		this.state = {
			apiIndex,
			historyIndex,
			initialConsecutiveMistakeCount,
			declaration: cloneDeep(declaration),
			...(passIdentity === undefined ? {} : { passIdentity: cloneDeep(passIdentity) }),
			openAiMaxOutputReplayUsed: false,
		}
	}

	/** Return the physical API-history index owned by the logical compaction request. */
	getHistoryIndex(apiIndex: number): number | undefined {
		if (this.state?.apiIndex !== apiIndex) return undefined
		return this.state.historyIndex
	}

	/** Return the task mistake counter captured before the first compaction attempt. */
	getInitialConsecutiveMistakeCount(apiIndex: number): number | undefined {
		if (this.state?.apiIndex !== apiIndex) return undefined
		return this.state.initialConsecutiveMistakeCount
	}

	/** Return the authorization declaration needed to replay a persisted compaction request. */
	getDeclaration(apiIndex: number): ExplicitInstructionDeclaration | undefined {
		if (this.state?.apiIndex !== apiIndex) return undefined
		return cloneDeep(this.state.declaration)
	}

	/**
	 * Capture the first complete provider input and always return a detached copy of
	 * that canonical value. Later calls for the same request cannot overwrite it.
	 */
	captureProviderInput(apiIndex: number, input: CompactionProviderInput): CompactionProviderInput {
		if (this.state?.apiIndex !== apiIndex) {
			throw new Error(`Compaction replay is not active for apiIndex=${apiIndex}`)
		}
		if (!this.state.providerInput) {
			this.state.providerInput = cloneDeep(input)
			this.state.inputHash = hashProviderInput(this.state.providerInput)
			this.state.initialProviderOutputCap = input.providerOutputCap
			this.state.currentProviderOutputCap = input.providerOutputCap
		}
		return this.getProviderInput(apiIndex) as CompactionProviderInput
	}

	/** Read a detached copy of the canonical provider input for a retry. */
	getProviderInput(apiIndex: number): CompactionProviderInput | undefined {
		if (this.state?.apiIndex !== apiIndex || !this.state.providerInput) return undefined
		const input = cloneDeep(this.state.providerInput)
		input.providerOutputCap = this.state.currentProviderOutputCap
		return input
	}

	/** Start the next attempt for the immutable current Pass. */
	beginAttempt(apiIndex: number, authorizationAttemptId: string): CompactionAttemptIdentity {
		if (this.state?.apiIndex !== apiIndex) {
			throw new Error(`Compaction replay is not active for apiIndex=${apiIndex}`)
		}
		if (!authorizationAttemptId.trim()) {
			throw new Error("Compaction authorization attempt ID must be non-empty")
		}
		if (!this.state.passIdentity || !this.state.inputHash) {
			throw new Error(`Compaction Pass identity or frozen provider input is missing at apiIndex=${apiIndex}`)
		}
		const currentAttempt: CompactionAttemptIdentity = {
			...cloneDeep(this.state.passIdentity),
			attemptIndex: (this.state.currentAttempt?.attemptIndex ?? -1) + 1,
			authorizationAttemptId,
			inputHash: this.state.inputHash,
		}
		this.state.currentAttempt = currentAttempt
		return cloneDeep(currentAttempt)
	}

	/** Return whether the immutable Pass is still active for this logical request. */
	isActivePass(apiIndex: number, identity: CompactionPassIdentity): boolean {
		return (
			this.state?.apiIndex === apiIndex &&
			this.state.passIdentity !== undefined &&
			samePassIdentity(this.state.passIdentity, identity)
		)
	}

	/** Return whether a result still belongs to the latest attempt of the active Pass. */
	isCurrentAttempt(apiIndex: number, identity: CompactionAttemptIdentity): boolean {
		const current = this.state?.apiIndex === apiIndex ? this.state.currentAttempt : undefined
		return current !== undefined && sameAttemptIdentity(current, identity)
	}

	/** Validate an authorization attempt against the current Pass plan. */
	isCurrentAuthorizationAttempt(passIdentity: CompactionPassIdentity, authorizationAttemptId: string): boolean {
		const current = this.state?.currentAttempt
		return (
			current !== undefined &&
			current.authorizationAttemptId === authorizationAttemptId &&
			samePassIdentity(current, passIdentity)
		)
	}

	/**
	 * Apply the one allowed OpenAI max-output replay reduction. Other failures keep
	 * the current request cap unchanged and remain owned by their normal retry policy.
	 */
	prepareOpenAiMaxOutputReplay(apiIndex: number, error: unknown): OpenAiMaxOutputReplayDecision {
		if (this.state?.apiIndex !== apiIndex || !isOutputLimitExceededError(error)) return "not_applicable"
		const isOpenAiMaxOutput =
			(error.protocol === "openai_chat" && error.reason === "length") ||
			(error.protocol === "openai_responses" && error.reason === "max_output_tokens")
		if (!isOpenAiMaxOutput) return "not_applicable"
		if (this.state.openAiMaxOutputReplayUsed) return "exhausted"

		const initialCap = this.state.initialProviderOutputCap
		if (initialCap === undefined) return "exhausted"
		const reducedCap = Math.floor(initialCap * 0.9)
		if (reducedCap <= 0) return "exhausted"

		this.state.openAiMaxOutputReplayUsed = true
		this.state.currentProviderOutputCap = reducedCap
		return "replay"
	}

	/** Clear the active request, optionally only when its index still matches. */
	clear(apiIndex?: number): void {
		if (apiIndex !== undefined && this.state?.apiIndex !== apiIndex) return
		this.state = undefined
	}
}

function hashProviderInput(input: CompactionProviderInput): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex")}`
}

function samePassIdentity(left: CompactionPassIdentity, right: CompactionPassIdentity): boolean {
	return (
		left.operationId === right.operationId &&
		left.passIndex === right.passIndex &&
		left.passStartTurnIndex === right.passStartTurnIndex &&
		left.passEndTurnIndex === right.passEndTurnIndex &&
		left.coveredTurnCount === right.coveredTurnCount &&
		left.summaryBaselineHash === right.summaryBaselineHash &&
		left.sourceHistoryHash === right.sourceHistoryHash &&
		left.passStartMessageIndex === right.passStartMessageIndex &&
		left.passEndMessageIndex === right.passEndMessageIndex &&
		left.rangeHash === right.rangeHash &&
		left.passHistoryHash === right.passHistoryHash
	)
}

function sameAttemptIdentity(left: CompactionAttemptIdentity, right: CompactionAttemptIdentity): boolean {
	return (
		samePassIdentity(left, right) &&
		left.attemptIndex === right.attemptIndex &&
		left.authorizationAttemptId === right.authorizationAttemptId &&
		left.inputHash === right.inputHash
	)
}
