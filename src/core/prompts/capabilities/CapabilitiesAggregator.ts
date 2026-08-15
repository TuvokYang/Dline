import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import type { SkillToggleState } from "@core/context/instructions/user-instructions/skills"
import { discoverAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { getSubagentsScanDirectories, getWorkflowsScanDirectories } from "@core/storage/disk"
import { parseAgentConfigFromYaml } from "@core/task/tools/subagent/AgentConfigLoader"
import { DEFAULT_SUBAGENT_CONFIG } from "@core/task/tools/subagent/DefaultSubagentConfig"
import type { McpServer } from "@shared/mcp"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import type { CapabilitiesSnapshot, CapabilityEntry } from "./types"

export interface CapabilityToggleState extends SkillToggleState {
	readonly workflowToggles?: Record<string, boolean>
	readonly globalWorkflowToggles?: Record<string, boolean>
	readonly subagentToggles?: Record<string, boolean>
	readonly globalSubagentToggles?: Record<string, boolean>
}

export interface CapabilityMcpHub {
	getServers(): McpServer[]
}

export interface CollectCapabilitiesInput extends CapabilityToggleState {
	readonly cwd: string
	readonly mcpHub?: CapabilityMcpHub
}

/**
 * Normalize a capability description for stable prompt rendering.
 *
 * @param description Raw capability description.
 * @returns Single-line prompt-safe description.
 */
function normalizeDescription(description: string | undefined): string {
	return (description ?? "").replace(/\s+/g, " ").trim().slice(0, 240)
}

/**
 * Sort and de-duplicate capability entries by name.
 *
 * @param entries Raw capability entries.
 * @returns Stable capability entries.
 */
function stableEntries(entries: CapabilityEntry[]): CapabilityEntry[] {
	const deduped = new Map<string, CapabilityEntry>()
	for (const entry of entries) {
		const name = entry.name.trim()
		if (!name || deduped.has(name)) {
			continue
		}
		deduped.set(name, { name, description: normalizeDescription(entry.description) })
	}
	return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Convert MCP tools into prompt-safe capability entries.
 *
 * @param mcpHub MCP hub that exposes connected servers.
 * @returns MCP capability entries containing only name and description.
 */
function collectMcp(mcpHub: CapabilityMcpHub | undefined): CapabilityEntry[] {
	if (!mcpHub) {
		return []
	}
	return stableEntries(
		mcpHub
			.getServers()
			.filter((server) => server.status === "connected" && server.disabled !== true)
			.flatMap((server) =>
				(server.tools ?? []).map((tool) => ({
					name: `${server.name}.${tool.name}`,
					description: tool.description ?? "",
				})),
			),
	)
}

/**
 * Convert enabled skills into prompt-safe capability entries.
 *
 * @param input Capability collection input.
 * @returns Skill capability entries containing only name and description.
 */
async function collectSkills(input: CollectCapabilitiesInput): Promise<CapabilityEntry[]> {
	const skills = await discoverAvailableSkills(input.cwd, input)
	return stableEntries(skills.map((skill) => ({ name: skill.name, description: skill.description })))
}

/**
 * Check whether a capability path is enabled by local or global toggles.
 *
 * @param filePath Capability file path.
 * @param source Capability source scope.
 * @param localToggles Local toggle map keyed by path.
 * @param globalToggles Global toggle map keyed by path.
 * @returns True when the capability is not explicitly disabled.
 */
function isEnabledPath(
	filePath: string,
	source: "project" | "global",
	localToggles: Record<string, boolean> | undefined,
	globalToggles: Record<string, boolean> | undefined,
): boolean {
	const toggles = source === "global" ? globalToggles : localToggles
	return toggles?.[filePath] !== false
}

/**
 * Read workflow files recursively with stable ordering.
 *
 * @param directoryPath Directory to scan.
 * @returns Markdown workflow file paths.
 */
async function readWorkflowFiles(directoryPath: string): Promise<string[]> {
	try {
		const dirEntries = (await fs.readdir(directoryPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
		const nested = await Promise.all(
			dirEntries.map(async (entry) => {
				const entryPath = path.join(directoryPath, entry.name)
				if (entry.isDirectory()) {
					return readWorkflowFiles(entryPath)
				}
				return /\.(md|mdx)$/i.test(entry.name) ? [entryPath] : []
			}),
		)
		return nested.flat()
	} catch {
		return []
	}
}

/**
 * Collect workflow files from configured scan directories.
 *
 * @param input Capability collection input.
 * @returns Workflow capability entries containing only name and description.
 */
async function collectWorkflows(input: CollectCapabilitiesInput): Promise<CapabilityEntry[]> {
	const entries: CapabilityEntry[] = []
	for (const dir of getWorkflowsScanDirectories(input.cwd)) {
		if (!(await fileExistsAtPath(dir.path)) || !(await isDirectory(dir.path))) {
			continue
		}
		const files = await readWorkflowFiles(dir.path)
		for (const filePath of files) {
			if (!isEnabledPath(filePath, dir.source, input.workflowToggles, input.globalWorkflowToggles)) {
				continue
			}
			try {
				const content = await fs.readFile(filePath, "utf8")
				const { data } = parseYamlFrontmatter(content)
				const name = typeof data.name === "string" ? data.name : path.basename(filePath, path.extname(filePath))
				const description = typeof data.description === "string" ? data.description : ""
				entries.push({ name, description })
			} catch {}
		}
	}
	return stableEntries(entries)
}

/**
 * Collect subagent YAML configs from configured scan directories.
 *
 * @param input Capability collection input.
 * @returns Subagent capability entries containing only name and description.
 */
async function collectSubagents(input: CollectCapabilitiesInput): Promise<CapabilityEntry[]> {
	const entries: CapabilityEntry[] = []
	for (const dir of getSubagentsScanDirectories(input.cwd)) {
		if (!(await fileExistsAtPath(dir.path)) || !(await isDirectory(dir.path))) {
			continue
		}
		const files = (await fs.readdir(dir.path)).sort((a, b) => a.localeCompare(b))
		for (const fileName of files) {
			if (!/\.(yaml|yml)$/i.test(fileName)) {
				continue
			}
			const filePath = path.join(dir.path, fileName)
			if (!isEnabledPath(filePath, dir.source, input.subagentToggles, input.globalSubagentToggles)) {
				continue
			}
			try {
				const content = await fs.readFile(filePath, "utf8")
				const config = parseAgentConfigFromYaml(content)
				entries.push({ name: config.name, description: config.description })
			} catch {}
		}
	}
	entries.push({ name: DEFAULT_SUBAGENT_CONFIG.name, description: DEFAULT_SUBAGENT_CONFIG.description })
	return stableEntries(entries)
}

/**
 * Collect prompt-safe capabilities from MCP, skills, workflows, and subagents.
 *
 * @param input Capability collection input.
 * @returns Snapshot containing only capability names and descriptions.
 */
export async function collectCapabilities(input: CollectCapabilitiesInput): Promise<CapabilitiesSnapshot> {
	const [skills, workflows, subagents] = await Promise.all([
		collectSkills(input),
		collectWorkflows(input),
		collectSubagents(input),
	])
	return {
		mcp: collectMcp(input.mcpHub),
		skills,
		workflows,
		subagents,
	}
}
