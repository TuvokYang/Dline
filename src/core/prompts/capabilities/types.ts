export type CapabilitySource = "mcp" | "skills" | "workflows" | "subagents"

/**
 * Represents the prompt-safe identity of one capability.
 */
export interface CapabilityEntry {
	readonly name: string
	readonly description: string
}

/**
 * Stores all prompt-safe capability groups for a task prompt snapshot.
 */
export interface CapabilitiesSnapshot {
	readonly mcp: readonly CapabilityEntry[]
	readonly skills: readonly CapabilityEntry[]
	readonly workflows: readonly CapabilityEntry[]
	readonly subagents: readonly CapabilityEntry[]
}
