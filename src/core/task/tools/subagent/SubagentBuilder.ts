import { buildApiHandler } from "@core/api"
import { readApiProfiles } from "@core/controller/file/getApiProfiles"
import { ClineDefaultTool } from "@shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { DEFAULT_SUBAGENT_ALLOWED_TOOLS } from "./DefaultSubagentConfig"

export type AgentConfig = Partial<AgentBaseConfig>

export const SUBAGENT_DEFAULT_ALLOWED_TOOLS = DEFAULT_SUBAGENT_ALLOWED_TOOLS

export const SUBAGENT_SYSTEM_SUFFIX = `\n\n# Subagent Execution Mode
You are running as a research subagent. Your job is to explore the codebase and gather information to answer the question.
Explore, read related files, trace through call chains, and build a complete picture before reporting back.
You can read files, list directories, search for patterns, list code definitions, and run commands.
Only use execute_command for readonly operations like ls, grep, git log, git diff, gh, etc.
When it makes sense, be clever about chaining commands or in-command scripting in execute_command to quickly get relevant context - and using pipes / filters to help narrow results.
Do not run commands that modify files or system state.
When you have a comprehensive answer, call the attempt_completion tool.
The attempt_completion result field is sent directly to the main agent, so put your full final findings there.
Unless the subagent prompt explicitly asks for detailed analysis, keep the result concise and focus on the files the main agent should read next.
Include a section titled "Relevant file paths" and list only file paths, one per line.
Do not include line numbers, summaries, or per-file explanations unless explicitly requested.
`

export class SubagentBuilder {
	private readonly agentConfig: AgentConfig = {}
	private readonly allowedTools: ClineDefaultTool[]
	private readonly apiHandler: ReturnType<typeof buildApiHandler>

	constructor(
		private readonly baseConfig: TaskConfig,
		_subagentName?: string,
		agentConfig?: AgentBaseConfig,
	) {
		this.agentConfig = agentConfig ?? {}
		this.allowedTools = this.resolveAllowedTools(this.agentConfig.tools)

		const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
		const effectiveApiConfiguration = {
			...apiConfiguration,
			actModeProfile: this.resolveProfile(this.agentConfig.profile, apiConfiguration.actModeProfile),
			ulid: this.baseConfig.ulid,
		}
		this.apiHandler = buildApiHandler(effectiveApiConfiguration, "act")
	}

	getApiHandler(): ReturnType<typeof buildApiHandler> {
		return this.apiHandler
	}

	getAllowedTools(): ClineDefaultTool[] {
		return this.allowedTools
	}

	getConfiguredSkills(): string[] | undefined {
		return this.agentConfig.skills
	}

	getConfiguredMaxOutputTokens(): number | undefined {
		return this.agentConfig.maxOutputTokens
	}

	buildSystemPrompt(generatedSystemPrompt: string): string {
		const configuredSystemPrompt = this.agentConfig?.systemPrompt?.trim()
		const systemPrompt = configuredSystemPrompt || generatedSystemPrompt
		return `${systemPrompt}${this.buildAgentIdentitySystemPrefix()}${SUBAGENT_SYSTEM_SUFFIX}`
	}

	/**
	 * Resolve the effective act profile for a subagent.
	 *
	 * @param configuredProfile Optional profile name from subagent YAML.
	 * @param defaultProfile Act profile used when no valid subagent profile exists.
	 * @returns Valid subagent profile name or the default act profile.
	 */
	private resolveProfile(configuredProfile: string | null | undefined, defaultProfile?: string): string | undefined {
		const profileName = configuredProfile?.trim()
		if (!profileName) {
			return defaultProfile
		}
		const profile = readApiProfiles().find((candidate) => candidate.name === profileName)
		if (!profile?.enabled || !profile.usedFor.includes("subagents")) {
			return defaultProfile
		}
		return profile.name
	}

	/**
	 * Resolve allowed subagent tools from config and defaults.
	 * @param configuredTools Optional YAML configured tools.
	 * @returns De-duplicated tool allowlist with attempt_completion enforced.
	 */
	private resolveAllowedTools(configuredTools?: ClineDefaultTool[]): ClineDefaultTool[] {
		const sourceTools = configuredTools && configuredTools.length > 0 ? configuredTools : SUBAGENT_DEFAULT_ALLOWED_TOOLS
		return Array.from(new Set([...sourceTools, ClineDefaultTool.ATTEMPT]))
	}

	/**
	 * Build an identity section for configured subagents.
	 * @returns Agent identity prompt section or empty text.
	 */
	private buildAgentIdentitySystemPrefix(): string {
		const name = this.agentConfig?.name?.trim()
		const description = this.agentConfig?.description?.trim()
		if (!name && !description) {
			return ""
		}

		const lines = ["# Agent Profile"]
		if (name) {
			lines.push(`Name: ${name}`)
		}
		if (description) {
			lines.push(`Description: ${description}`)
		}

		return `${lines.join("\n")}\n\n`
	}
}
