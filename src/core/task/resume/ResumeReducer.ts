import type { TaskSnapshot } from "../TaskSnapshot"
import type { ResumeEntry } from "./ResumeInput"

/** Select the only allowed entry for one already presented interaction. */
export function selectAwaitingResumeEntry(snapshot: TaskSnapshot): ResumeEntry {
	const interaction = snapshot.interaction
	if (!interaction) throw new Error("resume_interaction_missing")
	switch (interaction.kind) {
		case "resume":
			return { type: "show_resume_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
		case "completion":
			return { type: "show_completion_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
		case "error_retry":
			return {
				type: "show_error_recovery",
				interactionId: interaction.interactionId,
				turnId: interaction.turnId,
				apiIndex: snapshot.anchor?.apiIndex ?? snapshot.apiIndex,
			}
		default:
			return { type: "reopen_interaction", interactionId: interaction.interactionId, turnId: interaction.turnId }
	}
}
