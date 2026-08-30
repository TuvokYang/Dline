/**
 * Whether a task in this phase can still reach a queue delivery point.
 *
 * Retained input leaves the queue at a turn end or at the start of a tool
 * round, and both belong to a task that is still working. A task that has
 * finished, aborted or been paused reaches neither, so accepting input into
 * the queue there would hide it from the user with nothing left to send it.
 *
 * Written as a phase list rather than a negated list of terminal phases: a new
 * phase should have to opt in to holding the user's input, not inherit it.
 */
const PHASES_THAT_REACH_A_DELIVERY_POINT: ReadonlySet<string> = new Set([
	"initializing",
	"streaming",
	"awaiting_approval",
	"executing",
	"between_turns",
	"resuming",
])

/**
 * Report whether retained input could still be delivered to this task.
 *
 * Takes the phase as a string because the Webview receives it through the
 * projection rather than as the backend enum.
 */
export function taskPhaseStillDelivers(phase: string): boolean {
	return PHASES_THAT_REACH_A_DELIVERY_POINT.has(phase)
}
