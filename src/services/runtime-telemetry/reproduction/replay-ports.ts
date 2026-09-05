/**
 * Ports a reproduction scenario is allowed to touch.
 *
 * A diagnostic bundle describes a failure that already happened. Replaying it
 * must never re-run the original side effects: the maintainer opening a bug
 * report is not the user who chose to run that command, call that MCP tool, or
 * write that file. Every effectful capability is therefore expressed as a
 * narrow port, and the runner accepts nothing else.
 *
 * The default implementation records the request and returns the recorded
 * outcome. That is what lets a test prove "no side effect" as a property of the
 * design rather than as a code review promise: there is no wiring from a
 * scenario to a real terminal, client, socket, or file system.
 */

/** Effect category a step wants to perform. */
export enum ReplayEffect {
	Command = "command",
	McpTool = "mcp_tool",
	Network = "network",
	FileWrite = "file_write",
	/** Component the classifier does not recognise; never replayed. */
	Unknown = "unknown",
}

/**
 * A single replay request.
 *
 * The request carries identity and the recorded outcome only. It deliberately
 * has no argv, body, payload, or path: those are the fields that would make a
 * real execution possible, and they are also the fields most likely to hold
 * user content.
 */
export interface ReplayRequest {
	readonly effect: ReplayEffect
	readonly component: string
	readonly operation: string
	/** Outcome recorded when the incident happened. */
	readonly recordedOutcome: string
	readonly recordedDurationMs?: number
}

export interface ReplayResult {
	readonly outcome: string
	readonly durationMs: number
	/**
	 * Always `true`.
	 *
	 * The literal type is the enforcement: a port that performed real work
	 * could not honestly return it, so "no side effect" is checked by the
	 * compiler at every implementation site rather than asserted in a test
	 * that only ever sees a cooperative fake.
	 */
	readonly simulated: true
}

/** The single capability a scenario runner is given. */
export interface ReplayPort {
	perform(request: ReplayRequest): ReplayResult
}

/**
 * Replay port that performs nothing and returns the recorded outcome.
 *
 * Kept observable through `requests` so a test can assert both that the runner
 * routed every step through the port and that no other channel was used.
 */
export class FakeReplayPort implements ReplayPort {
	private readonly performed: ReplayRequest[] = []

	get requests(): readonly ReplayRequest[] {
		return this.performed
	}

	get callCount(): number {
		return this.performed.length
	}

	countFor(effect: ReplayEffect): number {
		return this.performed.reduce((total, request) => (request.effect === effect ? total + 1 : total), 0)
	}

	perform(request: ReplayRequest): ReplayResult {
		this.performed.push(request)
		return {
			outcome: request.recordedOutcome,
			durationMs: request.recordedDurationMs ?? 0,
			simulated: true,
		}
	}
}

/**
 * Replay port that refuses every request.
 *
 * Used where a caller wants a scenario inspected but never executed, so an
 * accidental run fails loudly instead of quietly reporting simulated success.
 */
export class RejectingReplayPort implements ReplayPort {
	perform(request: ReplayRequest): ReplayResult {
		throw new ReplayNotPermitted(request)
	}
}

export class ReplayNotPermitted extends Error {
	constructor(readonly request: ReplayRequest) {
		super(`replay of ${request.component}.${request.operation} is not permitted`)
		this.name = "ReplayNotPermitted"
	}
}
