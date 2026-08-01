import { getSubagentsScanDirectories } from "@core/storage/disk"
import { parseAgentConfigFromYaml } from "@core/task/tools/subagent/AgentConfigLoader"
import { RefreshedSubagents, SubagentInfo } from "@shared/proto/dline/file"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath, isDirectory } from "@/utils/fs"
import { Controller } from ".."

/**
 * Scan a directory for subagent YAML config files.
 * Each .yml/.yaml file = one subagent.
 */
/** Track already-warned file paths to avoid log flooding during polling. */
const warnedPaths = new Set<string>()

async function scanSubagentsDirectory(dirPath: string): Promise<SubagentInfo[]> {
	const subagents: SubagentInfo[] = []

	if (!(await fileExistsAtPath(dirPath)) || !(await isDirectory(dirPath))) {
		return subagents
	}

	try {
		const entries = await fs.readdir(dirPath)

		for (const entryName of entries) {
			if (!/\.(yaml|yml)$/i.test(entryName)) continue

			const filePath = path.join(dirPath, entryName)
			try {
				const content = await fs.readFile(filePath, "utf8")
				const config = parseAgentConfigFromYaml(content)

				// Clear warning on successful parse
				warnedPaths.delete(filePath)

				subagents.push(
					SubagentInfo.create({
						name: config.name,
						description: config.description,
						path: filePath,
						enabled: true, // Will be updated with toggle state
						tools: config.tools,
						skills: config.skills || [],
						profile: config.profile ?? undefined,
					}),
				)
			} catch (error) {
				if (!warnedPaths.has(filePath)) {
					warnedPaths.add(filePath)
					Logger.warn(`Failed to parse subagent config: ${filePath}`, error)
				}
			}
		}
	} catch (error) {
		Logger.warn(`Failed to read subagents directory: ${dirPath}`, error)
	}

	return subagents
}

/**
 * Refreshes all subagent toggles (discovers subagents and their enabled state).
 *
 * Scan strategy:
 *   - Project: .agents/subagents/*.yml
 *   - Global:  ~/.agents/subagents/*.yml
 *   - Project overrides global on name collision.
 */
export async function refreshSubagents(controller: Controller): Promise<RefreshedSubagents> {
	try {
		// Get workspace paths for local subagents
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const primaryWorkspace = workspacePaths.paths[0]

		const globalSubagents: SubagentInfo[] = []
		const localSubagents: SubagentInfo[] = []

		if (primaryWorkspace) {
			const scanDirs = getSubagentsScanDirectories(primaryWorkspace)
			for (const dir of scanDirs) {
				const agents = await scanSubagentsDirectory(dir.path)
				if (dir.source === "global") {
					globalSubagents.push(...agents)
				} else {
					localSubagents.push(...agents)
				}
			}
		} else {
			const scanDirs = getSubagentsScanDirectories("")
			for (const dir of scanDirs) {
				if (dir.source !== "global") continue
				const agents = await scanSubagentsDirectory(dir.path)
				globalSubagents.push(...agents)
			}
		}

		// Reconcile toggle maps with the current filesystem snapshot. This keeps
		// deleted files from leaving inert entries in settings and gives newly
		// discovered files the same default as the existing capability pickers.
		const localNames = new Set(localSubagents.map((agent) => agent.name))
		const visibleGlobalSubagents = globalSubagents.filter((agent) => !localNames.has(agent.name))
		const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSubagentsToggles") || {}
		const globalPaths = new Set(globalSubagents.map((agent) => agent.path))
		for (const togglePath of Object.keys(globalToggles)) {
			if (!globalPaths.has(togglePath)) delete globalToggles[togglePath]
		}
		for (const agent of visibleGlobalSubagents) {
			if (!(agent.path in globalToggles)) globalToggles[agent.path] = true
			agent.enabled = globalToggles[agent.path] !== false
		}

		const localToggles = controller.stateManager.getWorkspaceStateKey("localSubagentsToggles") || {}
		const localPaths = new Set(localSubagents.map((agent) => agent.path))
		for (const togglePath of Object.keys(localToggles)) {
			if (!localPaths.has(togglePath)) delete localToggles[togglePath]
		}
		for (const agent of localSubagents) {
			if (!(agent.path in localToggles)) localToggles[agent.path] = true
			agent.enabled = localToggles[agent.path] !== false
		}

		controller.stateManager.setGlobalState("globalSubagentsToggles", globalToggles)
		controller.stateManager.setWorkspaceState("localSubagentsToggles", localToggles)

		return RefreshedSubagents.create({
			globalSubagents: visibleGlobalSubagents,
			localSubagents,
		})
	} catch (error) {
		Logger.error("refreshSubagents failed:", error)
		return RefreshedSubagents.create({
			globalSubagents: [],
			localSubagents: [],
		})
	}
}
