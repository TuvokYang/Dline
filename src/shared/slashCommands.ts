/**
 * Strips the path prefix and file extension (.md/.txt) from a file path,
 * returning only the base name usable as a slash command name.
 */
export function pathToCommandName(filePath: string): string {
	return filePath.replace(/^.*[/\\]/, "").replace(/\.(md|txt)$/i, "")
}

/**
 * Extract the display name for a skill or workflow md file.
 * Reads the file's YAML frontmatter `name` field first;
 * falls back to path-based extraction if the file is unreadable
 * or has no name field.
 * @param filePath - Absolute path to the .md file
 * @param readFile - Async function to read file contents (e.g. fs.readFile)
 * @param parseYaml - Function to parse YAML frontmatter
 * @returns The display name string
 */
export async function extractNameFromMdFile(
	filePath: string,
	readFile: (p: string) => Promise<string>,
	parseYaml: (content: string) => { data: Record<string, unknown> },
): Promise<string> {
	try {
		const content = await readFile(filePath)
		const { data } = parseYaml(content)
		if (data.name && typeof data.name === "string") {
			return data.name
		}
	} catch {
		// File unreadable or parse error — fall through
	}
	return pathToCommandName(filePath)
}

export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "workflow" | "skill" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "Create a new task with context from the current task",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "Create a comprehensive implementation plan before coding",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "Condenses your current context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "newrule",
		description: "Create a new Cline rule based on your conversation",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "reportbug",
		description: "Create a Github issue with Cline",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "explain-changes",
		description: "Explain code changes between git refs (PRs, commits, branches, etc.)",
		section: "default",
	},
]

// CLI-only slash commands (handled locally, not sent to backend)
export const CLI_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "help",
		description: "Learn how to use Cline CLI",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "settings",
		description: "Change API provider, auto-approve, and feature settings",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "models",
		description: "Change the model used for the current mode",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "history",
		description: "Browse and search task history",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "clear",
		description: "Clear the current task and start fresh",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "exit",
		description: "Alternative to Ctrl+C",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "q",
		description: "Alternative to Ctrl+C",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "skills",
		description: "View and manage installed skills",
		section: "default",
		cliCompatible: true,
	},
]
