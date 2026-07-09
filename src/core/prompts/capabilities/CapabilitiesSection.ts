import type { CapabilitiesSnapshot, CapabilityEntry } from "./types"

const GROUPS: Array<{ readonly title: string; readonly key: keyof CapabilitiesSnapshot }> = [
	{ title: "MCP", key: "mcp" },
	{ title: "Skills", key: "skills" },
	{ title: "Workflows", key: "workflows" },
	{ title: "Subagents", key: "subagents" },
]

/**
 * Escape backticks in capability names before rendering inline code.
 *
 * @param name Capability name to render.
 * @returns Name with Markdown backticks escaped.
 */
function escapeName(name: string): string {
	return name.replace(/`/g, "\\`")
}

/**
 * Normalize capability descriptions into a single prompt-safe line.
 *
 * @param description Raw capability description.
 * @returns Sanitized description text.
 */
function normalizeDescription(description: string): string {
	return description.replace(/\s+/g, " ").trim().slice(0, 240)
}

/**
 * Render one capability entry using only name and description.
 *
 * @param entry Prompt-safe capability entry.
 * @returns Markdown list item for the capability.
 */
function renderEntry(entry: CapabilityEntry): string {
	return `- \`${escapeName(entry.name)}\`: ${normalizeDescription(entry.description)}`
}

/**
 * Render the task-level Capabilities system prompt section.
 *
 * @param snapshot Prompt-safe capabilities snapshot.
 * @returns Markdown section containing only capability names and descriptions.
 */
export function renderCapabilitiesSection(snapshot: CapabilitiesSnapshot): string {
	const sections = ["# Capabilities"]
	for (const group of GROUPS) {
		const entries = snapshot[group.key]
		if (entries.length === 0) {
			continue
		}
		sections.push(`## ${group.title}\n${entries.map(renderEntry).join("\n")}`)
	}
	return sections.join("\n\n")
}
