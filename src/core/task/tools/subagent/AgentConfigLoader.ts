import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool } from "@shared/tools"
import chokidar, { type FSWatcher } from "chokidar"
import fs from "fs/promises"
import * as path from "path"
import { z } from "zod"
import { getDlineSubagentsDirectoryPath } from "@/core/storage/disk"

export const AGENTS_CONFIG_DIRECTORY_NAME = "subagents"

const AgentBaseConfigSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	tools: z.array(z.nativeEnum(ClineDefaultTool)).default([]),
	skills: z.array(z.string().trim().min(1)).optional(),
	profile: z.string().trim().min(1).nullable().optional(),
	systemPrompt: z.string().trim().min(1),
})

const AgentConfigFrontmatterSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	profile: z.string().trim().min(1).nullable().optional(),
	tools: z.union([z.string(), z.array(z.string())]).optional(),
	skills: z.union([z.string(), z.array(z.string())]).optional(),
})

export type AgentBaseConfig = z.infer<typeof AgentBaseConfigSchema>

function normalizeToolName(toolName: string): ClineDefaultTool {
	const trimmed = toolName.trim()
	if (!trimmed) {
		throw new Error("Tool name cannot be empty.")
	}
	const asDefaultTool = trimmed as ClineDefaultTool
	if (Object.values(ClineDefaultTool).includes(asDefaultTool)) {
		return asDefaultTool
	}
	throw new Error(`Unknown tool '${trimmed}'. Expected a ClineDefaultTool value.`)
}

function parseTools(tools: string | string[] | undefined): ClineDefaultTool[] {
	if (!tools) return []
	const rawTools = Array.isArray(tools) ? tools : tools.split(",")
	if (rawTools.length === 0) return []
	return Array.from(new Set(rawTools.map(normalizeToolName)))
}

function normalizeSkillName(skillName: string): string {
	const trimmed = skillName.trim()
	if (!trimmed) throw new Error("Skill name cannot be empty.")
	return trimmed
}

function parseSkills(skills: string | string[] | undefined): string[] | undefined {
	if (skills === undefined) return undefined
	const rawSkills = Array.isArray(skills) ? skills : skills.split(",")
	return Array.from(new Set(rawSkills.map(normalizeSkillName)))
}

export function parseAgentConfigFromYaml(content: string): AgentBaseConfig {
	const { data, body, hadFrontmatter, parseError } = parseYamlFrontmatter(content)
	if (parseError) throw new Error(`Failed to parse YAML frontmatter: ${parseError}`)
	if (!hadFrontmatter) throw new Error("Missing YAML frontmatter block in agent config file.")
	const parsedFrontmatter = AgentConfigFrontmatterSchema.parse(data)
	const systemPrompt = body.trim()
	if (!systemPrompt) throw new Error("Missing system prompt body in agent config file.")
	return AgentBaseConfigSchema.parse({
		name: parsedFrontmatter.name,
		description: parsedFrontmatter.description,
		profile: parsedFrontmatter.profile,
		tools: parseTools(parsedFrontmatter.tools),
		skills: parseSkills(parsedFrontmatter.skills),
		systemPrompt,
	}) as AgentBaseConfig
}

function normalizeAgentName(name: string): string {
	return name.trim().toLowerCase()
}
function isYamlFile(filePath: string): boolean {
	return /\.(yaml|yml)$/i.test(filePath)
}

export async function readAgentConfigsFromDisk(dirPath: string): Promise<Map<string, AgentBaseConfig>> {
	const configs = new Map<string, AgentBaseConfig>()
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		const yamlFiles = entries
			.filter((e) => e.isFile())
			.map((e) => e.name)
			.filter(isYamlFile)
			.sort((a, b) => a.localeCompare(b))
		Logger.debug(`[AgentConfigLoader] Found ${yamlFiles.length} YAML file(s).`)
		await Promise.all(
			yamlFiles.map(async (fileName) => {
				const fp = path.join(dirPath, fileName)
				try {
					const content = await fs.readFile(fp, "utf8")
					const parsed = parseAgentConfigFromYaml(content)
					configs.set(normalizeAgentName(parsed.name), parsed)
				} catch (error) {
					Logger.error(`[AgentConfigLoader] Failed to parse agent config '${fileName}'`, error)
				}
			}),
		)
		return configs
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return configs
		Logger.error("[AgentConfigLoader] Failed to read agent configs from disk", error)
		throw error
	}
}

export type AgentConfigChangeListener = (configs: ReadonlyMap<string, AgentBaseConfig>, error?: Error) => void

export class AgentConfigLoader {
	private static instance?: AgentConfigLoader
	private readonly directoryPath: string
	private readonly initialLoadPromise: Promise<void>
	private watcher?: FSWatcher
	private cachedConfigs = new Map<string, AgentBaseConfig>()
	private listeners = new Set<AgentConfigChangeListener>()

	private constructor(dirPath: string) {
		this.directoryPath = dirPath
		this.initialLoadPromise = this.load()
			.then(() => undefined)
			.catch((e) => Logger.error("[AgentConfigLoader] Failed to load initial agent configs", e))
			.finally(() =>
				this.watch().catch((e) => Logger.error("[AgentConfigLoader] Failed to start watching agent configs", e)),
			)
	}

	public static getInstance(dirPath?: string): AgentConfigLoader {
		if (!AgentConfigLoader.instance) {
			AgentConfigLoader.instance = new AgentConfigLoader(dirPath || getDlineSubagentsDirectoryPath())
		}
		return AgentConfigLoader.instance
	}

	public static async resetInstanceForTests(): Promise<void> {
		if (!AgentConfigLoader.instance) return
		await AgentConfigLoader.instance.dispose()
		AgentConfigLoader.instance = undefined
	}

	public getConfigPath(): string {
		return this.directoryPath
	}
	public async ready(): Promise<void> {
		await this.initialLoadPromise
	}

	public getCachedConfig(subagentName?: string): AgentBaseConfig | undefined {
		if (!subagentName?.trim()) return undefined
		return this.cachedConfigs.get(normalizeAgentName(subagentName))
	}

	public getAllCachedConfigs(): ReadonlyMap<string, AgentBaseConfig> {
		return new Map(this.cachedConfigs)
	}

	public getAllCachedConfigsWithToolNames(): Array<{ toolName: string; config: AgentBaseConfig }> {
		return []
	}

	public resolveSubagentNameForTool(_toolName?: string): string | undefined {
		return undefined
	}

	public isDynamicSubagentTool(_toolName?: string): boolean {
		return false
	}

	public async load(): Promise<ReadonlyMap<string, AgentBaseConfig>> {
		const configs = await readAgentConfigsFromDisk(this.directoryPath)
		this.cachedConfigs = configs
		Logger.debug(`[AgentConfigLoader] Loaded ${configs.size} agent config(s) from disk.`)
		await this.ensureReadmeExists()
		return this.getAllCachedConfigs()
	}

	private async ensureReadmeExists(): Promise<void> {
		try {
			const readmePath = path.join(this.directoryPath, "README.md")
			if (
				await fs.stat(readmePath).then(
					() => true,
					() => false,
				)
			)
				return
			try {
				const entries = await fs.readdir(this.directoryPath)
				if (entries.some((e) => e.endsWith(".yml") || e.endsWith(".yaml"))) return
			} catch {
				/* directory doesn't exist yet */
			}
			await fs.mkdir(this.directoryPath, { recursive: true })
			await fs.writeFile(readmePath, SUBAGENT_README_CONTENT, "utf8")
			Logger.log("[AgentConfigLoader] Created README.md in agents directory")
		} catch (e) {
			Logger.warn("[AgentConfigLoader] Failed to write README.md:", e)
		}
	}

	public async watch(listener?: AgentConfigChangeListener): Promise<void> {
		if (listener) this.listeners.add(listener)
		if (this.watcher) return
		this.watcher = chokidar.watch(this.directoryPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
		})
		this.watcher
			.on("add", (fp) => {
				if (isYamlFile(fp)) void this.reloadAndNotify()
			})
			.on("change", (fp) => {
				if (isYamlFile(fp)) void this.reloadAndNotify()
			})
			.on("unlink", (fp) => {
				if (isYamlFile(fp)) void this.reloadAndNotify()
			})
			.on("error", (error) => {
				const e = error instanceof Error ? error : new Error(String(error))
				Logger.error("[AgentConfigLoader] Failed to watch agent configs directory", e)
				this.notify(this.cachedConfigs, e)
			})
	}

	public unwatch(listener: AgentConfigChangeListener): void {
		this.listeners.delete(listener)
	}

	public async dispose(): Promise<void> {
		if (!this.watcher) return
		await this.watcher.close()
		this.watcher = undefined
	}

	private async reloadAndNotify(): Promise<void> {
		try {
			await this.load()
			this.notify(this.cachedConfigs)
		} catch (error) {
			const e = error instanceof Error ? error : new Error(String(error))
			Logger.error("[AgentConfigLoader] Failed to reload agent configs", e)
			this.notify(this.cachedConfigs, e)
		}
	}

	private notify(configs: ReadonlyMap<string, AgentBaseConfig>, error?: Error): void {
		for (const listener of this.listeners) listener(new Map(configs), error)
	}

}

const SUBAGENT_README_CONTENT = `# Dline Subagents

Place \`.yml\` files here to define custom subagents. Each file = one subagent.

## YAML Format
\`\`\`yaml
---
name: my-agent
description: What this agent does
profile: (optional) ApiProfile name override
tools:           # optional — defaults to readonly set below
  - read_file
  - search_files
skills: (optional)
---
System prompt body for the subagent.
\`\`\`

## Available Tools

Read-only:
  read_file, search_files, list_files, list_code_definition_names
  browser_action, ask_followup_question, web_fetch, web_search
  use_skill, load_mcp_documentation, access_mcp_resource
  use_mcp_tool, plan_mode_respond, generate_explanation, focus_chain

Write (⚠️ use with caution — subagent can modify files):
  write_to_file, replace_in_file, execute_command
  attempt_completion, apply_patch

## Default Subagent (when no YAML is configured)
Subagents use these defaults if no YAML overrides are present:
  Tools: read_file, search_files, list_files, list_code_definition_names,
         execute_command (readonly commands only), use_skill, attempt_completion
  Profile: default act profile
  System prompt: research subagent — explore codebase, read files,
                 run readonly commands, report findings. No file modifications.
`
