import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { getDlineDocumentsPath, getDocumentsPath } from "@/core/storage/disk"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath, isDirectory } from "@/utils/fs"

/**
 * Result of a migration operation from Cline to Dline paths.
 */
export interface MigrationResult {
	migrated: boolean
	details: string[]
}

export interface ClineToDlineMigrationOptions {
	homeDir?: string
	documentsDir?: string
	dlineDocumentsDir?: string
	legacyVscodeGlobalStoragePaths?: string[]
}

interface MigrationStep {
	detail: string
	run: () => Promise<boolean>
}

const IGNORED_EMPTY_DIR_ENTRIES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])

async function directoryHasContent(dir: string): Promise<boolean> {
	if (!(await isDirectory(dir))) {
		return false
	}

	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (!IGNORED_EMPTY_DIR_ENTRIES.has(entry.name)) {
			return true
		}
	}

	return false
}

async function directoryHasChildDirectory(dir: string): Promise<boolean> {
	if (!(await isDirectory(dir))) {
		return false
	}

	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory() && !IGNORED_EMPTY_DIR_ENTRIES.has(entry.name)) {
			return true
		}
	}

	return false
}

async function isEmptyDirectoryTarget(dir: string): Promise<boolean> {
	if (!(await fileExistsAtPath(dir))) {
		return true
	}

	if (!(await isDirectory(dir))) {
		return false
	}

	return !(await directoryHasContent(dir))
}

async function shouldCopyDirectory(src: string, dest: string): Promise<boolean> {
	return (await directoryHasContent(src)) && (await isEmptyDirectoryTarget(dest))
}

async function shouldCopyFile(src: string, dest: string): Promise<boolean> {
	return (await fileExistsAtPath(src)) && !(await fileExistsAtPath(dest))
}

async function copyDirIntoEmptyTarget(src: string, dest: string): Promise<void> {
	if (!(await isEmptyDirectoryTarget(dest))) {
		throw new Error(`Migration destination is not empty: ${dest}`)
	}

	await copyDirContents(src, dest)
}

async function copyDirContents(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true })

	for (const entry of await fs.readdir(src, { withFileTypes: true })) {
		if (IGNORED_EMPTY_DIR_ENTRIES.has(entry.name)) {
			continue
		}

		const sourcePath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)

		if (entry.isDirectory()) {
			await copyDirContents(sourcePath, destPath)
			continue
		}

		if (await fileExistsAtPath(destPath)) {
			throw new Error(`Migration destination file already exists: ${destPath}`)
		}

		await fs.copyFile(sourcePath, destPath)
	}
}

async function copyFileIntoEmptyTarget(src: string, dest: string): Promise<void> {
	if (await fileExistsAtPath(dest)) {
		throw new Error(`Migration destination file already exists: ${dest}`)
	}

	await fs.mkdir(path.dirname(dest), { recursive: true })
	await fs.copyFile(src, dest)
}

function uniquePaths(paths: string[] | undefined): string[] {
	const seen = new Set<string>()
	const result: string[] = []

	for (const candidate of paths ?? []) {
		const normalized = path.normalize(candidate)
		const key = process.platform === "win32" ? normalized.toLowerCase() : normalized
		if (seen.has(key)) {
			continue
		}

		seen.add(key)
		result.push(normalized)
	}

	return result
}

async function getMigrationPaths(options: ClineToDlineMigrationOptions) {
	const homeDir = options.homeDir ?? os.homedir()
	const documentsDir = options.documentsDir ?? (await getDocumentsPath())
	const dlineDocumentsDir = options.dlineDocumentsDir ?? (await getDlineDocumentsPath())

	return {
		oldData: path.join(homeDir, ".cline", "data"),
		newData: path.join(homeDir, ".dline", "data"),
		oldEndpoints: path.join(homeDir, ".cline", "endpoints.json"),
		newEndpoints: path.join(homeDir, ".dline", "endpoints.json"),
		oldDocuments: path.join(documentsDir, "Cline"),
		newDocuments: dlineDocumentsDir,
		newTasksDir: path.join(dlineDocumentsDir, "tasks"),
		legacyVscodeGlobalStoragePaths: uniquePaths(options.legacyVscodeGlobalStoragePaths),
	}
}

async function createTaskMigrationStep(
	legacyVscodeGlobalStoragePaths: string[],
	newTasksDir: string,
): Promise<MigrationStep | undefined> {
	if (!(await isEmptyDirectoryTarget(newTasksDir))) {
		return undefined
	}

	const legacyTaskSources: Array<{
		globalStoragePath: string
		taskHistoryPath: string
		tasksDir: string
		hasTaskHistory: boolean
		hasTaskDirs: boolean
	}> = []

	for (const globalStoragePath of legacyVscodeGlobalStoragePaths) {
		const taskHistoryPath = path.join(globalStoragePath, "state", "taskHistory.json")
		const tasksDir = path.join(globalStoragePath, "tasks")
		const hasTaskHistory = await fileExistsAtPath(taskHistoryPath)
		const hasTaskDirs = await directoryHasChildDirectory(tasksDir)

		if (hasTaskHistory || hasTaskDirs) {
			legacyTaskSources.push({ globalStoragePath, taskHistoryPath, tasksDir, hasTaskHistory, hasTaskDirs })
		}
	}

	if (legacyTaskSources.length === 0) {
		return undefined
	}

	if (legacyTaskSources.length > 1) {
		Logger.warn(
			`[Migration] Multiple legacy Cline VSCode storage paths contain task data; using the first path only: ${legacyTaskSources
				.map((source) => source.globalStoragePath)
				.join(", ")}`,
		)
	}

	const source = legacyTaskSources[0]
	return {
		detail: "legacy VSCode task data -> Documents/Dline/tasks/",
		run: async () => {
			if (!(await isEmptyDirectoryTarget(newTasksDir))) {
				Logger.log(`[Migration] Skipped legacy VSCode task data: destination is not empty: ${newTasksDir}`)
				return false
			}

			await fs.mkdir(newTasksDir, { recursive: true })
			let copied = false

			if (source.hasTaskHistory) {
				await copyFileIntoEmptyTarget(source.taskHistoryPath, path.join(newTasksDir, "taskHistory.json"))
				copied = true
			}

			if (source.hasTaskDirs) {
				for (const entry of await fs.readdir(source.tasksDir, { withFileTypes: true })) {
					if (!entry.isDirectory() || IGNORED_EMPTY_DIR_ENTRIES.has(entry.name)) {
						continue
					}

					await copyDirContents(path.join(source.tasksDir, entry.name), path.join(newTasksDir, entry.name))
					copied = true
				}
			}

			return copied
		},
	}
}

async function buildMigrationPlan(options: ClineToDlineMigrationOptions = {}): Promise<MigrationStep[]> {
	if (process.env.DLINE_HOME_DIR || process.env.DLINE_DOCS_DIR) {
		return []
	}

	const paths = await getMigrationPaths(options)
	const steps: MigrationStep[] = []

	if (await shouldCopyDirectory(paths.oldData, paths.newData)) {
		steps.push({
			detail: "~/.cline/data/ -> ~/.dline/data/",
			run: async () => {
				if (!(await shouldCopyDirectory(paths.oldData, paths.newData))) {
					return false
				}
				await copyDirIntoEmptyTarget(paths.oldData, paths.newData)
				return true
			},
		})
	}

	if (await shouldCopyFile(paths.oldEndpoints, paths.newEndpoints)) {
		steps.push({
			detail: "~/.cline/endpoints.json -> ~/.dline/endpoints.json",
			run: async () => {
				if (!(await shouldCopyFile(paths.oldEndpoints, paths.newEndpoints))) {
					return false
				}
				await copyFileIntoEmptyTarget(paths.oldEndpoints, paths.newEndpoints)
				return true
			},
		})
	}

	if (await shouldCopyDirectory(paths.oldDocuments, paths.newDocuments)) {
		steps.push({
			detail: "Documents/Cline/ -> Documents/Dline/",
			run: async () => {
				if (!(await shouldCopyDirectory(paths.oldDocuments, paths.newDocuments))) {
					return false
				}
				await copyDirIntoEmptyTarget(paths.oldDocuments, paths.newDocuments)
				return true
			},
		})
	}

	const taskStep = await createTaskMigrationStep(paths.legacyVscodeGlobalStoragePaths, paths.newTasksDir)
	if (taskStep) {
		steps.push(taskStep)
	}

	return steps
}

export async function hasClineToDlineMigrationCandidates(options: ClineToDlineMigrationOptions = {}): Promise<boolean> {
	return (await buildMigrationPlan(options)).length > 0
}

/**
 * Migrate data from legacy Cline paths to Dline paths.
 *
 * The migration is intentionally conservative: each target location must be
 * missing or empty before data is copied. Existing Dline data is never merged
 * with legacy Cline data and is never overwritten.
 */
export async function migrateFromClineToDline(options: ClineToDlineMigrationOptions = {}): Promise<MigrationResult> {
	if (process.env.DLINE_HOME_DIR || process.env.DLINE_DOCS_DIR) {
		Logger.log("[Migration] Skipped: custom Dline paths configured via environment variables")
		return { migrated: false, details: [] }
	}

	const details: string[] = []
	let migrated = false
	const steps = await buildMigrationPlan(options)

	for (const step of steps) {
		try {
			Logger.log(`[Migration] Copying ${step.detail} ...`)
			if (await step.run()) {
				details.push(step.detail)
				migrated = true
				Logger.log(`[Migration] Completed: ${step.detail}`)
			}
		} catch (error) {
			Logger.error(`[Migration] Failed: ${step.detail}`, error)
			details.push(`${step.detail} failed: ${error}`)
		}
	}

	Logger.log("[Migration] Result:", { migrated, details })
	return { migrated, details }
}
