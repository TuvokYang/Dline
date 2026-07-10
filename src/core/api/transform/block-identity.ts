import { monotonicFactory } from "ulid"

/** Stable identity metadata shared by Dline logical content blocks. */
export interface BlockIdentity {
	/** Stable identity of one logical provider or Dline content item. */
	item_id: string
	/** Dline trace identity spanning stream, execution, result, and restore. */
	dline_tid: string
}

/** Function pairing identity shared by native tool use and result blocks. */
export interface FunctionIdentity extends BlockIdentity {
	/** Provider-neutral function call and result pairing identity. */
	function_id: string
}

/** Allocates Dline-owned item and trace identities. */
export interface IdentityFactory {
	/**
	 * Allocate the next Dline item identity.
	 *
	 * @returns A prefixed item identity.
	 */
	nextItemId(): string
	/**
	 * Allocate the next Dline trace identity.
	 *
	 * @returns A prefixed trace identity.
	 */
	nextTraceId(): string
}

/** Diagnostic metadata for a missing provider function identity. */
export interface MissingFunctionIdentityDetails {
	provider: string
	apiFormat: string
	itemId: string
	traceId: string
	toolName: string
}

/** Error raised when a native tool call lacks its provider pairing identity. */
export class MissingFunctionIdentityError extends Error {
	readonly details: MissingFunctionIdentityDetails

	/**
	 * Create an execution-blocking native tool identity error.
	 *
	 * @param details Provider and block metadata used for diagnostics.
	 */
	constructor(details: MissingFunctionIdentityDetails) {
		super(
			`Native tool call is missing function_id: provider=${details.provider} apiFormat=${details.apiFormat} item_id=${details.itemId} dline_tid=${details.traceId} tool=${details.toolName}`,
		)
		this.name = "MissingFunctionIdentityError"
		this.details = details
	}
}

/**
 * Create a task-local allocator for Dline-owned identities.
 *
 * @param nextUlid Optional deterministic ULID source used by tests.
 * @returns An allocator that never creates provider function identities.
 */
export function createIdentityFactory(nextUlid: () => string = monotonicFactory()): IdentityFactory {
	return {
		nextItemId: () => `dline_item_${nextUlid()}`,
		nextTraceId: () => `dline_tid_${nextUlid()}`,
	}
}
