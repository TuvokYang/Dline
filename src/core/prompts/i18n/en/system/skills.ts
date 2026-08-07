// English skills prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	catalogGuidance:
		'Skills provide task-specific methods, constraints, and best practices so work follows a proven domain approach instead of generic reasoning. Match the request to an advertised description. Use `load_skill` once with the exact name, then follow the returned instructions directly for the current task. If `<explicit_instructions type="skill">` is already present, follow those instructions directly and do not call `load_skill` again.',
	catalogListIntroduction: "The Skills available to the current task are listed below:",
}

export default prompts
