import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import { EmptyRequest } from "@shared/proto/dline/common"
import { SlashCommandInfo, SlashCommandsResponse } from "@shared/proto/dline/slash"
import fs from "fs/promises"
import { BASE_SLASH_COMMANDS, extractNameFromMdFile } from "@/shared/slashCommands"
import { Controller } from ".."

const MAX_DESCRIPTION_LENGTH = 80

/** Truncate a description string if it exceeds the max length */
function truncateDescription(desc: string): string {
	return desc.length > MAX_DESCRIPTION_LENGTH ? `${desc.slice(0, MAX_DESCRIPTION_LENGTH)}…` : desc
}

/** Extract and truncate description from a workflow file's YAML frontmatter */
async function extractWorkflowDescription(filePath: string): Promise<string | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		const { data, body } = parseYamlFrontmatter(raw)
		if (data.description && typeof data.description === "string") {
			return truncateDescription(data.description)
		}
		// Fallback to first meaningful line of markdown body
		const firstLine = body.trim().split("\n")[0].trim()
		const cleanLine = firstLine.replace(/^#+\s*/, "").trim()
		if (cleanLine) {
			return truncateDescription(cleanLine)
		}
	} catch {
		// File read failed — fall through
	}
	return undefined
}

/**
 * Returns all available slash commands for autocomplete.
 * Includes built-in commands (cmd: prefix), workflows (workflow: prefix),
 * skills (skills: prefix), and MCP prompts (mcp: prefix via frontend).
 */
export async function getAvailableSlashCommands(controller: Controller, _request: EmptyRequest): Promise<SlashCommandsResponse> {
	const commands: SlashCommandInfo[] = []

	// Add built-in commands
	for (const cmd of [...BASE_SLASH_COMMANDS]) {
		commands.push(
			SlashCommandInfo.create({
				name: cmd.name,
				description: cmd.description,
				section: "default",
				cliCompatible: cmd.cliCompatible,
			}),
		)
	}

	// Get workflow toggles from state
	const localWorkflowToggles = controller.stateManager.getWorkspaceStateKey("workflowToggles") ?? {}
	const globalWorkflowToggles = controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles") ?? {}
	const remoteWorkflowToggles = controller.stateManager.getGlobalStateKey("remoteWorkflowToggles") ?? {}
	const remoteConfigSettings = controller.stateManager.getRemoteConfigSettings()
	const remoteWorkflows = remoteConfigSettings?.remoteGlobalWorkflows ?? []

	// Track local workflow names to avoid duplicates from global
	const localNames = new Set<string>()

	// Add local workflows (enabled only, section="workflow", name="xxx")
	for (const [filePath, enabled] of Object.entries(localWorkflowToggles)) {
		if (enabled) {
			const baseName = await extractNameFromMdFile(filePath, (p) => fs.readFile(p, "utf-8"), parseYamlFrontmatter)
			localNames.add(baseName)
			const description = await extractWorkflowDescription(filePath)
			commands.push(
				SlashCommandInfo.create({
					name: baseName,
					description: description || "",
					section: "workflow",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add global workflows (enabled only, skip if local exists with same name)
	for (const [filePath, enabled] of Object.entries(globalWorkflowToggles)) {
		if (enabled) {
			const baseName = await extractNameFromMdFile(filePath, (p) => fs.readFile(p, "utf-8"), parseYamlFrontmatter)
			if (!localNames.has(baseName)) {
				const description = await extractWorkflowDescription(filePath)
				commands.push(
					SlashCommandInfo.create({
						name: baseName,
						description: description || "",
						section: "workflow",
						cliCompatible: true,
					}),
				)
			}
		}
	}

	// Add remote workflows that are enabled
	for (const workflow of remoteWorkflows) {
		const enabled = workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
		if (enabled) {
			let description = ""
			if (workflow.contents) {
				const { data } = parseYamlFrontmatter(workflow.contents)
				if (data.description && typeof data.description === "string") {
					description = truncateDescription(data.description)
				}
			}
			commands.push(
				SlashCommandInfo.create({
					name: workflow.name,
					description,
					section: "workflow",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add skills (section="skill", name="xxx")
	const localSkillsToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
	const globalSkillsToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
	const remoteSkillsToggles = controller.stateManager.getGlobalStateKey("remoteSkillsToggles") ?? {}
	const remoteGlobalSkills = remoteConfigSettings?.remoteGlobalSkills ?? []

	const skillNames = new Set<string>()

	// Add local skills (enabled only)
	for (const [path, enabled] of Object.entries(localSkillsToggles)) {
		if (enabled) {
			const skillName = await extractNameFromMdFile(path, (p) => fs.readFile(p, "utf-8"), parseYamlFrontmatter)
			if (!skillName) continue
			skillNames.add(skillName)
			commands.push(
				SlashCommandInfo.create({
					name: skillName,
					description: `Skill: ${skillName}`,
					section: "skill",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add global skills (enabled only, skip if local exists with same name)
	for (const [path, enabled] of Object.entries(globalSkillsToggles)) {
		if (enabled) {
			const skillName = await extractNameFromMdFile(path, (p) => fs.readFile(p, "utf-8"), parseYamlFrontmatter)
			if (!skillName || skillNames.has(skillName)) continue
			skillNames.add(skillName)
			commands.push(
				SlashCommandInfo.create({
					name: skillName,
					description: `Skill: ${skillName}`,
					section: "skill",
					cliCompatible: true,
				}),
			)
		}
	}

	// Add remote skills that are enabled
	for (const skill of remoteGlobalSkills) {
		const enabled = skill.alwaysEnabled || remoteSkillsToggles[skill.name] !== false
		if (enabled) {
			commands.push(
				SlashCommandInfo.create({
					name: skill.name,
					description: `Remote skill: ${skill.name}`,
					section: "skill",
					cliCompatible: true,
				}),
			)
		}
	}

	return SlashCommandsResponse.create({ commands })
}
