// English capability-catalog prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	heading: "# Capabilities",
	nativeHeading: "# CAPABILITIES",
	mcpTitle: "MCP",
	skillsTitle: "Skills",
	workflowsTitle: "Workflows",
	subagentsTitle: "Subagents",
	inputSchemaHeading: "Input Schema:",
	availableToolsHeading: "Available Tools",
	entry: "- `@NAME@`: @DESCRIPTION@",
	group: "## @TITLE@\n@ENTRIES@",
}

export default prompts
