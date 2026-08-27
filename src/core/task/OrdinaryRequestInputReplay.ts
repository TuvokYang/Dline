import type { CompactionProviderInput } from "@core/task/compaction/CompactionRequestReplay"
import cloneDeep from "clone-deep"

interface OrdinaryRequestInputState {
	apiIndex: number
	providerInput: CompactionProviderInput
}

/** Retains one immutable ordinary Provider input across first-chunk retry attempts. */
export class OrdinaryRequestInputReplay {
	private state?: OrdinaryRequestInputState

	/** Freeze the latest admitted logical request, replacing any older unacknowledged request. */
	freeze(apiIndex: number, providerInput: CompactionProviderInput): void {
		this.state = { apiIndex, providerInput: cloneDeep(providerInput) }
	}

	/** Return a detached copy of the frozen request for an initial send or retry. */
	get(apiIndex: number): CompactionProviderInput | undefined {
		if (this.state?.apiIndex !== apiIndex) return undefined
		return cloneDeep(this.state.providerInput)
	}

	/** Release the request after its first real Provider chunk is accepted. */
	acknowledge(apiIndex: number): void {
		if (this.state?.apiIndex === apiIndex) this.state = undefined
	}

	/** Invalidate the frozen request before canonical state or projection changes. */
	clear(): void {
		this.state = undefined
	}
}
