import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { getDlineDocumentsPath, getDocumentsPath } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath, isDirectory } from "@/utils/fs"

/**
 * Result of a migration operation from Cline to Dline paths.
 */
export interface MigrationResult {
	migrated: boolean
	details: string[]
}

/**
 * Recursively copy a directory from src to dest.
 */
async function copyDir(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true })
	for (const e of await fs.readdir(src, { withFileTypes: true })) {
		const sp = path.join(src, e.name)
		const dp = path.join(dest, e.name)
		e.isDirectory() ? await copyDir(sp, dp) : await fs.copyFile(sp, dp)
	}
}

/**
 * Migrate data from legacy Cline paths to Dline paths on first run.
 * Copies all user data, settings, and task history. Does NOT delete old files.
 *
 * Designed to be called from platform-specific code (e.g. VSCode extension.ts)
 * with progress reporting via vscode.window.withProgress.
 *
 * @returns MigrationResult with details of what was migrated
 */
export async function migrateFromClineToDline(): Promise<MigrationResult> {
	// Skip migration when running in dev/fresh mode with custom paths
	if (process.env.DLINE_HOME_DIR || process.env.DLINE_DOCS_DIR) {
		Logger.log("[Migration] Skipped — custom Dline paths configured via environment variables")
		return { migrated: false, details: [] }
	}

	const details: string[] = []
	let migrated = false

	// 1. ~/.cline/data/ → ~/.dline/data/
	const oldData = path.join(os.homedir(), ".cline", "data")
	const newData = path.join(os.homedir(), ".dline", "data")
	if ((await isDirectory(oldData)) && !(await isDirectory(newData))) {
		try {
			Logger.log("[Migration] Copying ~/.cline/data/ → ~/.dline/data/ ...")
			await copyDir(oldData, newData)
			details.push("~/.cline/data/ → ~/.dline/data/")
			migrated = true
			Logger.log("[Migration] Completed: ~/.cline/data/ → ~/.dline/data/")
		} catch (e) {
			Logger.error("[Migration] Failed to copy ~/.cline/data/:", e)
			details.push(`data migration failed: ${e}`)
		}
	}

	// 2. ~/.cline/endpoints.json → ~/.dline/endpoints.json
	const oldEp = path.join(os.homedir(), ".cline", "endpoints.json")
	const newEp = path.join(os.homedir(), ".dline", "endpoints.json")
	if ((await fileExistsAtPath(oldEp)) && !(await fileExistsAtPath(newEp))) {
		try {
			await fs.copyFile(oldEp, newEp)
			details.push("~/.cline/endpoints.json → ~/.dline/endpoints.json")
			migrated = true
		} catch (e) {
			details.push(`endpoints.json migration failed: ${e}`)
		}
	}

	// 3. VSCode globalStorage state/taskHistory.json → Documents/Dline/tasks/
	const oldTh = path.resolve(HostProvider.get().globalStorageFsPath, "state", "taskHistory.json")
	const newTh = path.join(await getDlineDocumentsPath(), "tasks", "taskHistory.json")
	if ((await fileExistsAtPath(oldTh)) && !(await fileExistsAtPath(newTh))) {
		try {
			await fs.mkdir(path.dirname(newTh), { recursive: true })
			await fs.copyFile(oldTh, newTh)
			details.push("taskHistory.json → Documents/Dline/tasks/")
			migrated = true
		} catch (e) {
			details.push(`taskHistory.json migration failed: ${e}`)
		}
	}

	// 4. VSCode globalStorage tasks/ directories → Documents/Dline/tasks/
	const oldTasks = path.resolve(HostProvider.get().globalStorageFsPath, "tasks")
	const newTasksDir = path.join(await getDlineDocumentsPath(), "tasks")
	if (await isDirectory(oldTasks)) {
		let c = 0
		for (const e of await fs.readdir(oldTasks, { withFileTypes: true })) {
			if (e.isDirectory()) {
				const ot = path.join(oldTasks, e.name)
				const nt = path.join(newTasksDir, e.name)
				if (!(await isDirectory(nt))) {
					try {
						await copyDir(ot, nt)
						c++
					} catch {
						// skip individual task failures
					}
				}
			}
		}
		if (c > 0) {
			details.push(`${c} task directories migrated`)
			migrated = true
		}
	}

	// 5. ~/Documents/Cline/ → ~/Documents/Dline/
	const oldDocs = path.join(await getDocumentsPath(), "Cline")
	const newDocs = path.join(await getDocumentsPath(), "Dline")
	if ((await isDirectory(oldDocs)) && !(await isDirectory(newDocs))) {
		try {
			await copyDir(oldDocs, newDocs)
			details.push("Documents/Cline/ → Documents/Dline/")
			migrated = true
		} catch (e) {
			details.push(`Documents migration failed: ${e}`)
		}
	}

	Logger.log("[Migration] Result:", { migrated, details })
	return { migrated, details }
}
