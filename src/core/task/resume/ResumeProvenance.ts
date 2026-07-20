import { getPrompt, renderPrompt } from "@core/prompts/i18n"

/** Structured facts that explain why a task is resuming. */
export interface ResumeProvenance {
	readonly session: "restored_after_close"
	readonly previousToolResult: "missing"
	readonly previousToolOutcome: "unknown"
}

const RESTORED_PROVENANCE: ResumeProvenance = {
	session: "restored_after_close",
	previousToolResult: "missing",
	previousToolOutcome: "unknown",
}

/** Return the canonical facts for a restored task session. */
export function getRestoredResumeProvenance(): ResumeProvenance {
	return RESTORED_PROVENANCE
}

/** Project restored-session facts for the Resume interaction UI. */
export function createResumeInteractionPresentation(): string {
	return getPrompt("resumeProvenance", "interactionPresentation")
}

/** Project a provider-compatible synthetic result without guessing execution success or failure. */
export function createMissingToolResultMessage(toolName: string): string {
	return renderPrompt("resumeProvenance", "missingToolResult", { TOOL_NAME: toolName })
}

/** Project restored-session provenance into the next model continuation. */
export function createResumeContinuationText(userText?: string): string {
	const provenance = createResumeInteractionPresentation()
	const draft = userText?.trim()
	return draft
		? renderPrompt("resumeProvenance", "continuationWithUserText", {
				PROVENANCE: provenance,
				USER_TEXT: draft,
			})
		: provenance
}
