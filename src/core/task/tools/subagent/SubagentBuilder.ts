import { buildApiHandler } from "@core/api"
import { readApiProfiles } from "@core/controller/file/getApiProfiles"
import { ClineDefaultTool } from "@shared/tools"
import type { TaskConfig } from "../types/TaskConfig"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { DEFAULT_SUBAGENT_ALLOWED_TOOLS, isDefaultSubagentName } from "./DefaultSubagentConfig"

export type AgentConfig = Partial<AgentBaseConfig>

export const SUBAGENT_DEFAULT_ALLOWED_TOOLS = DEFAULT_SUBAGENT_ALLOWED_TOOLS

export const SUBAGENT_COMPLETION_CONTRACT = `# Required Completion Protocol
A subagent run can finish and return to its parent only by calling the attempt_completion tool with a non-empty result field.
Plain assistant text cannot complete a subagent run, even when it contains final findings, an error, or a blocker.
When the work is complete or cannot proceed, call attempt_completion and put the full findings or blocker in result.`

export const SUBAGENT_SYSTEM_SUFFIX = `# Subagent Execution Mode
You are running as a research subagent. Your job is to explore the codebase and gather information to answer the question.
Explore, read related files, trace through call chains, and build a complete picture before reporting back.
Use only the tools exposed for this subagent profile.
Unless the subagent prompt explicitly asks for detailed analysis, keep the result concise and focus on the files the main agent should read next.
Include a section titled "Relevant file paths" and list only file paths, one per line.
Do not include line numbers, summaries, or per-file explanations unless explicitly requested.

${SUBAGENT_COMPLETION_CONTRACT}`

export class SubagentBuilder {
	private readonly agentConfig: AgentConfig = {}
	private readonly allowedTools: ClineDefaultTool[]
	private readonly apiHandler: ReturnType<typeof buildApiHandler>

	constructor(
		private readonly baseConfig: TaskConfig,
		subagentName?: string,
		agentConfig?: AgentBaseConfig,
	) {
		this.agentConfig = agentConfig ?? {}
		this.allowedTools = this.resolveAllowedTools(this.agentConfig.tools, !subagentName || isDefaultSubagentName(subagentName))

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
		const configuredSystemPrompt = this.agentConfig.systemPrompt?.trim()
		const sections = [
			generatedSystemPrompt.trim(),
			configuredSystemPrompt ? `# Subagent Custom Instructions\n${configuredSystemPrompt}` : "",
			this.buildAgentIdentitySystemPrefix(),
			SUBAGENT_SYSTEM_SUFFIX,
		]
		return sections.filter(Boolean).join("\n\n")
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
	private resolveAllowedTools(configuredTools: ClineDefaultTool[] | undefined, builtInDefault: boolean): ClineDefaultTool[] {
		const sourceTools = configuredTools && configuredTools.length > 0 ? configuredTools : SUBAGENT_DEFAULT_ALLOWED_TOOLS
		const boundedTools = builtInDefault ? sourceTools.filter((tool) => tool !== ClineDefaultTool.BASH) : sourceTools
		return Array.from(new Set([...boundedTools, ClineDefaultTool.ATTEMPT]))
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

		return lines.join("\n")
	}
}
