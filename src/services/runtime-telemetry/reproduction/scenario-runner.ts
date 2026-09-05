import type { ScenarioStep } from "../export/bundle-builder"
import { ReplayEffect, ReplayNotPermitted, type ReplayPort, type ReplayRequest, type ReplayResult } from "./replay-ports"

/**
 * Replays a recorded scenario through a single injected port.
 *
 * The runner is deliberately thin: it classifies each step, hands it to the
 * port, and reports what the port returned. All effect execution lives behind
 * the port, so "a scenario cannot touch the machine" is enforced by the type
 * signature instead of by discipline.
 *
 * Timing is reported, never awaited. Sleeping through the original delays
 * would make replaying an incident as slow as the incident itself and would
 * add nothing: the recorded duration is already in the step.
 */

/** Effect classification for a step, derived from its component name. */
const COMPONENT_EFFECTS: Readonly<Record<string, ReplayEffect>> = {
	terminal: ReplayEffect.Command,
	terminalPool: ReplayEffect.Command,
	mcp: ReplayEffect.McpTool,
	provider: ReplayEffect.Network,
	telemetry: ReplayEffect.Network,
	checkpoint: ReplayEffect.FileWrite,
	settings: ReplayEffect.FileWrite,
	settingsRepository: ReplayEffect.FileWrite,
	fileLock: ReplayEffect.FileWrite,
}

/**
 * Steps whose component is unrecognised are classified as unknown.
 *
 * Mapping them onto an existing category would grant a new instrumentation
 * domain — or a component name invented by a hostile bundle — the permissions
 * of a category it was never reviewed for. Unknown is refused instead.
 */
const UNCLASSIFIED_EFFECT = ReplayEffect.Unknown

export interface ReplayedStep {
	readonly index: number
	readonly component: string
	readonly operation: string
	readonly effect: ReplayEffect
	readonly recordedOutcome: string
	readonly replayedOutcome: string
	readonly simulated: boolean
}

export interface ScenarioReplayReport {
	readonly steps: readonly ReplayedStep[]
	/** Steps whose replayed outcome differed from the recorded one. */
	readonly divergences: readonly number[]
	readonly totalRecordedDurationMs: number
}

export function classifyStepEffect(component: string): ReplayEffect {
	return COMPONENT_EFFECTS[component] ?? UNCLASSIFIED_EFFECT
}

/**
 * Replay every step through `port`.
 *
 * The caller supplies the port because the decision to allow any effect at all
 * belongs to the caller, not to the scenario file, which arrives from an
 * untrusted bug report.
 */
export function replayScenario(steps: readonly ScenarioStep[], port: ReplayPort): ScenarioReplayReport {
	const replayed: ReplayedStep[] = []
	const divergences: number[] = []
	let totalRecordedDurationMs = 0

	for (const step of steps) {
		const request: ReplayRequest = {
			effect: classifyStepEffect(step.component),
			component: step.component,
			operation: step.operation,
			recordedOutcome: step.outcome,
			recordedDurationMs: step.durationMs,
		}

		// Fail closed: an unclassified component is refused before it reaches
		// the port, so a port cannot be asked to act on an effect nobody
		// reviewed.
		if (request.effect === ReplayEffect.Unknown) {
			throw new ReplayNotPermitted(request)
		}

		const result: ReplayResult = port.perform(request)
		totalRecordedDurationMs += step.durationMs ?? 0

		if (result.outcome !== step.outcome) divergences.push(step.index)
		replayed.push({
			index: step.index,
			component: step.component,
			operation: step.operation,
			effect: request.effect,
			recordedOutcome: step.outcome,
			replayedOutcome: result.outcome,
			simulated: result.simulated,
		})
	}

	return { steps: replayed, divergences, totalRecordedDurationMs }
}
