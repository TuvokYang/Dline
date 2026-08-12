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
}

interface CompactionReplayState {
	apiIndex: number
	historyIndex: number
	declaration: ExplicitInstructionDeclaration
	providerInput?: CompactionProviderInput
}

/** Keeps the canonical provider input for the one active automatic compaction request. */
export class CompactionRequestReplay {
	private state?: CompactionReplayState

	/** Start a new logical compaction request and record its physical API-history boundary. */
	begin(apiIndex: number, historyIndex: number, declaration: ExplicitInstructionDeclaration): void {
		this.state = {
			apiIndex,
			historyIndex,
			declaration: cloneDeep(declaration),
		}
	}

	/** Return the physical API-history index owned by the logical compaction request. */
	getHistoryIndex(apiIndex: number): number | undefined {
		if (this.state?.apiIndex !== apiIndex) return undefined
		return this.state.historyIndex
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
		this.state.providerInput ??= cloneDeep(input)
		return cloneDeep(this.state.providerInput)
	}

	/** Read a detached copy of the canonical provider input for a retry. */
	getProviderInput(apiIndex: number): CompactionProviderInput | undefined {
		if (this.state?.apiIndex !== apiIndex || !this.state.providerInput) return undefined
		return cloneDeep(this.state.providerInput)
	}

	/** Clear the active request, optionally only when its index still matches. */
	clear(apiIndex?: number): void {
		if (apiIndex !== undefined && this.state?.apiIndex !== apiIndex) return
		this.state = undefined
	}
}
