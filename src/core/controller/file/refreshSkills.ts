import { parseRemoteSkillEntries } from "@core/context/instructions/user-instructions/skills"
import { resolveCapabilityToggles } from "@core/storage/settings/capability-toggle-store"
import { RefreshedSkills, SkillInfo } from "@shared/proto/dline/file"
import fs from "fs/promises"
import path from "path"
import { parseYamlFrontmatter } from "@/core/context/instructions/user-instructions/frontmatter"
import { getSkillsDirectoriesForScan } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath, isDirectory } from "@/utils/fs"
import { Controller } from ".."
import { coalesceCapabilityScan } from "./refresh-coalescing"

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 */
async function scanSkillsDirectory(dirPath: string): Promise<SkillInfo[]> {
	const skills: SkillInfo[] = []

	if (!(await fileExistsAtPath(dirPath)) || !(await isDirectory(dirPath))) {
		return skills
	}

	try {
		const entries = await fs.readdir(dirPath)

		for (const entryName of entries) {
			const entryPath = path.join(dirPath, entryName)
			const stats = await fs.stat(entryPath).catch(() => null)
			if (!stats?.isDirectory()) continue

			const skillMdPath = path.join(entryPath, "SKILL.md")
			if (!(await fileExistsAtPath(skillMdPath))) continue

			try {
				const fileContent = await fs.readFile(skillMdPath, "utf-8")
				const result = parseYamlFrontmatter(fileContent)
				if (result.parseError) {
					Logger.warn("Failed to parse YAML frontmatter:", result.parseError)
				}
				const frontmatter = result.data

				// Validate required fields
				if (!frontmatter.name || typeof frontmatter.name !== "string") continue
				if (!frontmatter.description || typeof frontmatter.description !== "string") continue
				if (frontmatter.name !== entryName) continue

				skills.push(
					SkillInfo.create({
						name: entryName,
						description: frontmatter.description,
						path: skillMdPath,
						enabled: true, // Will be updated with toggle state
					}),
				)
			} catch {
				// Skip invalid skills
			}
		}
	} catch {
		// Directory read error, skip
	}

	return skills
}

/**
 * Refreshes all skill toggles (discovers skills and their enabled state).
 *
 * Discovery is read-only: it reports what exists on disk and resolves the
 * effective state against stored preferences in memory. Persisting a preference
 * is reserved for explicit user toggles, so this stays off the storage write
 * path and never contends for the cross-process settings lock.
 */
export function refreshSkills(controller: Controller): Promise<RefreshedSkills> {
	// The skills tab polls this RPC directly while refreshRules() scans the same
	// directories on its own timer. Both entry points share one in-flight scan so
	// the panel cannot multiply filesystem walks on a large workspace.
	return coalesceCapabilityScan(controller, "skills", () => scanSkills(controller))
}

async function scanSkills(controller: Controller): Promise<RefreshedSkills> {
	const startedAt = performance.now()
	let scannedDirectories = 0
	// Get workspace paths for local skills
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const primaryWorkspace = workspacePaths.paths[0]

	const globalSkills: SkillInfo[] = []
	const localSkills: SkillInfo[] = []

	if (primaryWorkspace) {
		const scanDirs = getSkillsDirectoriesForScan(primaryWorkspace)
		for (const dir of scanDirs) {
			scannedDirectories++
			const skills = await scanSkillsDirectory(dir.path)
			if (dir.source === "global") {
				globalSkills.push(...skills)
			} else {
				localSkills.push(...skills)
			}
		}
	} else {
		const scanDirs = getSkillsDirectoriesForScan("")
		for (const dir of scanDirs) {
			if (dir.source !== "global") continue
			scannedDirectories++
			const skills = await scanSkillsDirectory(dir.path)
			globalSkills.push(...skills)
		}
	}

	// Resolve the discovered skills against the stored preferences without writing
	// them back. Remote entries use a separate name-keyed map and are handled below.
	const discoveredGlobalToggles = Object.fromEntries(globalSkills.map((skill) => [skill.path, true]))
	const globalToggles = resolveCapabilityToggles(controller.stateManager, "skills", discoveredGlobalToggles)
	for (const skill of globalSkills) {
		skill.enabled = globalToggles[skill.path] !== false
	}

	// Add remote skills from remote config.
	// Precedence: remote (enterprise) > disk-global (user) > project (workspace).
	// Remote entries are appended to globalSkills[] and split into the dedicated "Enterprise Skills"
	// section by the UI. The toggle store distinguishes them by the "remote:" path prefix.
	const remoteConfigSettings = controller.stateManager.getRemoteConfigSettings()
	const remoteSkillsToggles = controller.stateManager.getGlobalStateKey("remoteSkillsToggles") || {}
	const validatedRemoteSkills = parseRemoteSkillEntries(remoteConfigSettings.remoteGlobalSkills || [])

	for (const entry of validatedRemoteSkills) {
		const enabled = entry.alwaysEnabled || remoteSkillsToggles[entry.name] !== false

		globalSkills.push(
			SkillInfo.create({
				name: entry.name,
				description: entry.description,
				path: `remote:${entry.name}`,
				enabled,
				alwaysEnabled: entry.alwaysEnabled,
			}),
		)
	}

	// Resolve the workspace-level preferences the same way. Stale entries for
	// capabilities that no longer exist on disk are ignored here rather than
	// rewritten, which keeps discovery free of persistence side effects.
	const discoveredLocalToggles = Object.fromEntries(localSkills.map((skill) => [skill.path, true]))
	const localToggles = resolveCapabilityToggles(controller.stateManager, "skills", discoveredLocalToggles)
	for (const skill of localSkills) {
		skill.enabled = localToggles[skill.path] !== false
	}

	Logger.debug(
		`[CapabilityPerf] phase=skills_refresh taskId=${controller.task?.taskId ?? "none"} durationMs=${Math.round(performance.now() - startedAt)} directories=${scannedDirectories} global=${globalSkills.length} local=${localSkills.length} remote=${validatedRemoteSkills.length}`,
	)
	return RefreshedSkills.create({
		globalSkills,
		localSkills,
	})
}
