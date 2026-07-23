// English capability-catalog prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	heading: "# Capabilities",
	nativeHeading: "# CAPABILITIES",
	mcpTitle: "MCP",
	skillsTitle: "Skills",
	workflowsTitle: "Workflows",
	subagentsTitle: "Subagents",
	subagentsGuidance:
		"Use `use_subagent` for one default or named subagent. Use `use_subagents` for one to five parallel default subtasks.",
	inputSchemaHeading: "Input Schema:",
	availableToolsHeading: "Available Tools",
	entry: "- `@NAME@`: @DESCRIPTION@",
	group: "## @TITLE@\n@ENTRIES@",
}

export default prompts
