import { getInteraction } from "../interaction/InteractionRegistry"
import type { TaskSnapshot } from "../TaskSnapshot"
import type { ResumeEntry } from "./ResumeInput"

/** Select the only allowed entry for one already presented interaction. */
export function selectAwaitingResumeEntry(snapshot: TaskSnapshot): ResumeEntry {
	const interaction = snapshot.interaction
	if (!interaction) throw new Error("resume_interaction_missing")
	const continuation = getInteraction(interaction.kind).continuation
	if (interaction.kind === "error_retry" || interaction.kind === "mistake_limit") {
		return {
			type: "show_error_recovery",
			interactionId: interaction.interactionId,
			turnId: interaction.turnId,
			apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
		}
	}
	if (continuation === "completion") {
		return { type: "show_completion_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
	if (continuation === "resume") {
		return { type: "show_resume_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
	return { type: "reopen_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
}
