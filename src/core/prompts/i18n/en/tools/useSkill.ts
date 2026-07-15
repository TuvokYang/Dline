// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Load and activate a skill by name. Skills provide specialized instructions for specific tasks. Use this tool ONCE when a user's request matches one of the available skill descriptions shown in the SKILLS section of your system prompt. After activation, follow the skill's instructions directly - do not call use_skill again.",
	skillNameInstruction: "The name of the skill to activate (must match exactly one of the available skill names)",
}
export default prompts
