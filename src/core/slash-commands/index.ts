import type { ApiProviderInfo } from "@core/api"
import { ClineRulesToggles } from "@shared/cline-rules"
import { McpPromptResponse } from "@shared/mcp"
import { resolvePromptProfile } from "@shared/resolve-prompt-profile"
import { pathToCommandName } from "@shared/slashCommands"
import { SLASH_TYPE_DESC } from "@shared/slashContext"
import fs from "fs/promises"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import {
	condenseToolResponse,
	deepPlanningToolResponse,
	explainChangesToolResponse,
	newRuleToolResponse,
	newTaskToolResponse,
	reportBugToolResponse,
} from "../prompts/commands"
import { StateManager } from "../storage/StateManager"

/**
 * Callback type for fetching MCP prompts
 */
export type McpPromptFetcher = (serverName: string, promptName: string) => Promise<McpPromptResponse | null>

type FileBasedWorkflow = {
	fullPath: string
	fileName: string
	isRemote: false
}

type RemoteWorkflow = {
	fullPath: string
	fileName: string
	isRemote: true
	contents: string
}

type Workflow = FileBasedWorkflow | RemoteWorkflow

/**
 * Processes text for slash commands and transforms them with appropriate instructions
 * This is called after parseMentions() to process any slash commands in the user's message
 */
export async function parseSlashCommands(
	text: string,
	localWorkflowToggles: ClineRulesToggles,
	globalWorkflowToggles: ClineRulesToggles,
	ulid: string,
	focusChainSettings?: { enabled: boolean },
	enableNativeToolCalls?: boolean,
	providerInfo?: Readonly<ApiProviderInfo>,
	mcpPromptFetcher?: McpPromptFetcher,
): Promise<{ processedText: string; needsClinerulesFileCheck: boolean }> {
	const SUPPORTED_DEFAULT_COMMANDS = ["newtask", "smol", "compact", "newrule", "reportbug", "deep-planning", "explain-changes"]
	const promptProfile = resolvePromptProfile({
		modelId: providerInfo?.model.id,
		contextWindow: providerInfo?.model.info.capabilities?.contextWindow,
	})
	const commandFocusChainSettings = promptProfile === "standard" ? focusChainSettings : undefined

	const commandReplacements: Record<string, string> = {
		newtask: newTaskToolResponse(),
		smol: condenseToolResponse(commandFocusChainSettings),
		compact: condenseToolResponse(commandFocusChainSettings),
		newrule: newRuleToolResponse(),
		reportbug: reportBugToolResponse(),
		"deep-planning": deepPlanningToolResponse(promptProfile, commandFocusChainSettings, providerInfo, enableNativeToolCalls),
		"explain-changes": explainChangesToolResponse(),
	}

	// Regex patterns to extract content from different XML tags
	const tagPatterns = [
		{ tag: "task", regex: /<task>([\s\S]*?)<\/task>/i },
		{ tag: "feedback", regex: /<feedback>([\s\S]*?)<\/feedback>/i },
		{ tag: "answer", regex: /<answer>([\s\S]*?)<\/answer>/i },
		{ tag: "user_message", regex: /<user_message>([\s\S]*?)<\/user_message>/i },
	]

	// Regex to find slash commands anywhere in text (not just at the beginning).
	// This mirrors how @ mentions work - they can appear anywhere in a message.
	//
	// Pattern breakdown: /(^|\s)\/([a-zA-Z0-9_.:@-]+)(?=\s|$)/
	//   - (^|\s)  : Must be at start of string OR preceded by whitespace
	//   - \/      : The literal slash character
	//   - ([a-zA-Z0-9_.:@-]+) : The command name (letters, numbers, underscore, dot, hyphen, colon, @)
	//   - (?=\s|$): Must be followed by whitespace or end of string (lookahead)
	//
	// This safely avoids false matches in:
	//   - URLs: "http://example.com/newtask" - slash not preceded by whitespace
	//   - File paths: "some/path/newtask" - same reason
	//   - Partial words: "foo/bar" - same reason
	//
	// Only ONE slash command per message is processed (first match found).
	// Note: Colons are allowed to support prefix namespacing (cmd:, skills:, workflow:, mcp:)
	const slashCommandInTextRegex = /(^|\s)\/([a-zA-Z0-9_.:@-]+)(?=\s|$)/

	// Helper function to calculate positions and remove slash command from text
	const removeSlashCommand = (
		fullText: string,
		_tagContent: string, // kept for clarity about the context
		contentStartIndex: number,
		slashMatch: RegExpExecArray,
	): string => {
		// slashMatch.index is where the match starts (could include whitespace before /)
		// slashMatch[1] is the whitespace or empty string before the slash
		// slashMatch[2] is the command name
		const slashPositionInContent = slashMatch.index + slashMatch[1].length
		const slashPositionInFullText = contentStartIndex + slashPositionInContent
		const commandText = `/${slashMatch[2]}`
		const commandEndPosition = slashPositionInFullText + commandText.length

		return fullText.substring(0, slashPositionInFullText) + fullText.substring(commandEndPosition)
	}

	/**
	 * Parse the command name to extract prefix and unprefixed name.
	 * Supports namespaced formats: cmd:xxx, skills:xxx, workflow:xxx, mcp:xxx:xxx
	 * Returns { prefix, name } where prefix is the namespace and name is the rest.
	 * If no colon found, returns { prefix: null, name: commandName } for legacy matching.
	 */
	const parsePrefixedCommand = (commandName: string): { prefix: string | null; name: string } => {
		const colonIndex = commandName.indexOf(":")
		if (colonIndex === -1) {
			return { prefix: null, name: commandName }
		}
		return {
			prefix: commandName.substring(0, colonIndex),
			name: commandName.substring(colonIndex + 1),
		}
	}

	// if we find a valid match, we will return inside that block
	for (const { regex } of tagPatterns) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const tagMatch = regexObj.exec(text)

		if (tagMatch) {
			const tagContent = tagMatch[1]
			const tagStartIndex = tagMatch.index
			const contentStartIndex = text.indexOf(tagContent, tagStartIndex)

			// Find slash command within the tag content
			const slashMatch = slashCommandInTextRegex.exec(tagContent)

			if (!slashMatch) {
				continue
			}

			// slashMatch[1] is the whitespace or empty string before the slash
			// slashMatch[2] is the command name (may include prefix like "cmd:newtask")
			const commandName = slashMatch[2] // casing matters
			const { prefix, name } = parsePrefixedCommand(commandName)

			// ── Route by prefix ──────────────────────────────────────────────
			if (prefix === "cmd" || (prefix === null && SUPPORTED_DEFAULT_COMMANDS.includes(commandName))) {
				// Prefixed format: /cmd:newtask
				// Legacy format:  /newtask (backward compatibility)
				const cmdName = prefix === "cmd" ? name : commandName
				if (SUPPORTED_DEFAULT_COMMANDS.includes(cmdName)) {
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = commandReplacements[cmdName] + textWithoutSlashCommand

					telemetryService.captureSlashCommandUsed(ulid, cmdName, "builtin")

					return {
						processedText,
						needsClinerulesFileCheck: cmdName === "newrule",
					}
				}
			}

			// Check for MCP prompt commands (format: mcp:<server>:<prompt>)
			if (prefix === "mcp" && mcpPromptFetcher) {
				// name part may contain more colons: server:prompt
				const mcpParts = name.split(":")
				if (mcpParts.length >= 2) {
					const serverName = mcpParts[0]
					const promptName = mcpParts.slice(1).join(":")

					try {
						const promptResponse = await mcpPromptFetcher(serverName, promptName)
						if (promptResponse) {
							const promptContent = formatMcpPromptResponse(promptResponse)

							const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
							const processedText =
								`<mcp_prompt server="${serverName}" prompt="${promptName}">\n${promptContent}\n</mcp_prompt>\n` +
								textWithoutSlashCommand

							telemetryService.captureSlashCommandUsed(ulid, commandName, "mcp_prompt")

							return { processedText, needsClinerulesFileCheck: false }
						}
						Logger.debug(`MCP prompt not found: ${commandName} (server: ${serverName}, prompt: ${promptName})`)
					} catch (error) {
						Logger.error(`Error fetching MCP prompt ${commandName}: ${error}`)
					}
				}
			}

			// ── Skill matching (prefix: skills:) ─────────────────────────────
			// Reuses the same loading mechanism as UseSkillToolHandler
			if (prefix === "skills") {
				const skillName = name
				if (skillName) {
					const { discoverAvailableSkills, getSkillContent } = await import(
						"@core/context/instructions/user-instructions/skills"
					)
					const stateManager = StateManager.get()
					const remoteConfigSettings = stateManager.getRemoteConfigSettings()
					const remoteSkillEntries = remoteConfigSettings?.remoteGlobalSkills ?? []
					const availableSkills = await discoverAvailableSkills("", {
						remoteSkillEntries,
						globalSkillsToggles: stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {},
						localSkillsToggles: stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {},
						remoteSkillsToggles: stateManager.getGlobalStateKey("remoteSkillsToggles") ?? {},
					})

					const skillContent = await getSkillContent(skillName, availableSkills, remoteSkillEntries)
					if (skillContent) {
						const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
						const processedText =
							`<explicit_instructions type="skill" name="${skillName}" desc="${SLASH_TYPE_DESC.skill}">\n${skillContent.instructions}\n</explicit_instructions>\n` +
							textWithoutSlashCommand

						telemetryService.captureSlashCommandUsed(ulid, commandName, "skill")

						return { processedText, needsClinerulesFileCheck: false }
					}
				}
			}

			// ── Workflow matching (prefix: workflow: or legacy bare name) ────
			// Build workflow list (same as before but fileName uses pathToCommandName for strip .md)
			const globalWorkflows: Workflow[] = Object.entries(globalWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => ({
					fullPath: filePath,
					fileName: pathToCommandName(filePath),
					isRemote: false,
				}))

			const localWorkflows: Workflow[] = Object.entries(localWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => ({
					fullPath: filePath,
					fileName: pathToCommandName(filePath),
					isRemote: false,
				}))

			const stateManager = StateManager.get()
			const remoteConfigSettings = stateManager.getRemoteConfigSettings()
			const remoteWorkflows = remoteConfigSettings.remoteGlobalWorkflows || []
			const remoteWorkflowToggles = stateManager.getGlobalStateKey("remoteWorkflowToggles") || {}

			const enabledRemoteWorkflows: Workflow[] = remoteWorkflows
				.filter((workflow) => {
					return workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
				})
				.map((workflow) => ({
					fullPath: "",
					fileName: workflow.name,
					isRemote: true,
					contents: workflow.contents,
				}))

			const enabledWorkflows: Workflow[] = [...localWorkflows, ...globalWorkflows, ...enabledRemoteWorkflows]

			// Match by name: prefixed "/workflow:xxx" or legacy "/xxx"
			const searchName = prefix === "workflow" ? name : commandName
			const matchingWorkflow = enabledWorkflows.find((workflow) => workflow.fileName === searchName)

			if (matchingWorkflow) {
				try {
					let workflowContent: string
					if (matchingWorkflow.isRemote) {
						workflowContent = matchingWorkflow.contents.trim()
					} else {
						workflowContent = (await fs.readFile(matchingWorkflow.fullPath, "utf8")).trim()
					}

					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText =
						`<explicit_instructions type="workflow" name="${matchingWorkflow.fileName}" desc="${SLASH_TYPE_DESC.workflow}">\n${workflowContent}\n</explicit_instructions>\n` +
						textWithoutSlashCommand

					telemetryService.captureSlashCommandUsed(ulid, commandName, "workflow")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					Logger.error(`Error reading workflow file ${matchingWorkflow.fullPath}: ${error}`)
				}
			}

			// ── Legacy fallback: bare command name matching workflow (with .md still on file name) ──
			// This handles old-style commands like /git-branch-analysis.md
			if (prefix === null) {
				const legacyWorkflows: Workflow[] = Object.entries(globalWorkflowToggles)
					.filter(([_, enabled]) => enabled)
					.map(([filePath, _]) => ({
						fullPath: filePath,
						fileName: filePath.replace(/^.*[/\\]/, ""), // keep .md for legacy
						isRemote: false,
					}))
				const legacyLocalWorkflows: Workflow[] = Object.entries(localWorkflowToggles)
					.filter(([_, enabled]) => enabled)
					.map(([filePath, _]) => ({
						fullPath: filePath,
						fileName: filePath.replace(/^.*[/\\]/, ""),
						isRemote: false,
					}))
				const legacyEnabledWorkflows = [...legacyLocalWorkflows, ...legacyWorkflows, ...enabledRemoteWorkflows]
				const legacyMatch = legacyEnabledWorkflows.find((wf) => wf.fileName === commandName)
				if (legacyMatch) {
					try {
						let workflowContent: string
						if (legacyMatch.isRemote) {
							workflowContent = legacyMatch.contents.trim()
						} else {
							workflowContent = (await fs.readFile(legacyMatch.fullPath, "utf8")).trim()
						}
						const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
						const processedText =
							`<explicit_instructions type="workflow" name="${pathToCommandName(legacyMatch.fileName)}" desc="${SLASH_TYPE_DESC.workflow}">\n${workflowContent}\n</explicit_instructions>\n` +
							textWithoutSlashCommand

						telemetryService.captureSlashCommandUsed(ulid, commandName, "workflow")

						return { processedText, needsClinerulesFileCheck: false }
					} catch (error) {
						Logger.error(`Error reading workflow file ${legacyMatch.fullPath}: ${error}`)
					}
				}
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsClinerulesFileCheck: false }
}

/**
 * Formats MCP prompt response messages into a text format for injection
 */
export function formatMcpPromptResponse(response: McpPromptResponse): string {
	const parts: string[] = []

	if (response.description) {
		parts.push(`Description: ${response.description}`)
	}

	for (const message of response.messages) {
		const roleLabel = message.role === "user" ? "User" : "Assistant"

		if (message.content.type === "text") {
			parts.push(`[${roleLabel}]\n${message.content.text}`)
		} else if (message.content.type === "image") {
			parts.push(`[${roleLabel}]\n[Image: ${message.content.mimeType}]`)
		} else if (message.content.type === "audio") {
			parts.push(`[${roleLabel}]\n[Audio: ${message.content.mimeType}]`)
		} else if (message.content.type === "resource") {
			const resource = message.content.resource
			if (resource.text) {
				parts.push(`[${roleLabel}]\n[Resource: ${resource.uri}]\n${resource.text}`)
			} else {
				parts.push(`[${roleLabel}]\n[Resource: ${resource.uri}]`)
			}
		}
	}

	return parts.join("\n\n")
}
