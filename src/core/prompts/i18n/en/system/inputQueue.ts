// English InputQueue delivery prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	auxiliaryAlignmentV1:
		"The following content is auxiliary alignment information the user queued while work was in progress. " +
		"Use it to align subsequent execution. Unless the user explicitly asks for a different approach, " +
		"keep the agreed plan and apply only minor adjustments.",
}

export default prompts
