import { getInteraction } from "../interaction/InteractionRegistry"
import type { TaskSnapshot } from "../TaskSnapshot"
import type { ResumeEntry } from "./ResumeInput"

/** Select the original pending block when an interaction outcome is owned by its tool handler. */
function selectHandlerReplay(snapshot: TaskSnapshot): ResumeEntry | undefined {
	const interaction = snapshot.interaction
	const turn = snapshot.turn
	if (!interaction || !turn || turn.turnId !== interaction.turnId) return undefined
	const block = turn.blocks.find((candidate) => candidate.dlineTid === interaction.interactionId)
	if (!block) return undefined
	return {
		type: "replay_pending_blocks",
		turnId: turn.turnId,
		dlineTids: [block.dlineTid],
		answeredDlineTids: [],
	}
}

/** Select the only allowed entry for one already presented interaction. */
export function selectAwaitingResumeEntry(snapshot: TaskSnapshot): ResumeEntry {
	const interaction = snapshot.interaction
	if (!interaction) throw new Error("resume_interaction_missing")
	const continuation = getInteraction(interaction.kind).continuation
	if (continuation === "none") {
		const replay = selectHandlerReplay(snapshot)
		if (replay) return replay
	}
	if (continuation === "handler") {
		return { type: "reopen_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
	if (continuation === "completion") {
		return { type: "show_completion_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
	if (continuation === "resume") {
		return { type: "show_resume_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
	switch (interaction.kind) {
		case "error_retry":
			return {
				type: "show_error_recovery",
				interactionId: interaction.interactionId,
				turnId: interaction.turnId,
				apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
			}
		default:
			return {
				type: "read_only_failure",
				diagnostics: [{ code: "missing_interaction_continuation", interactionId: interaction.interactionId }],
			}
	}
}
