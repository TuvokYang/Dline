import * as path from "path"

const SUMMARY_LIMIT = 128
const MAX_EDITED_FILES = 50

export interface ActiveTaskSource {
	taskId: string
	getActiveTaskSummary(): string
	getActiveTaskPhase(): string
	getActiveTaskEditedFiles(): string[]
}

export interface ActiveTaskControllerSource {
	task?: ActiveTaskSource
}

export interface ActiveTasksSectionOptions {
	controllers: ActiveTaskControllerSource[]
	currentCwd: string
	/** Task ID to exclude from the active tasks list. */
	excludeTaskId?: string
}

/**
 * Build the Active Tasks environment details section.
 * @param options Active controller sources and current cwd for relative paths.
 * @returns Markdown section or an empty string when there are no active tasks.
 */
export function buildActiveTasksSection(options: ActiveTasksSectionOptions): string {
	const tasks = options.controllers
		.map((controller) => controller.task)
		.filter(isActiveTaskSource)
		.filter((task) => task.taskId !== options.excludeTaskId)
	if (tasks.length === 0) {
		return ""
	}

	const lines = ["# Active Tasks"]
	for (const task of tasks) {
		lines.push(`- id: ${task.taskId}`)
		lines.push(`  summary: ${truncateSummary(task.getActiveTaskSummary())}`)
		lines.push(`  phase: ${task.getActiveTaskPhase()}`)
		appendEditedFiles(lines, task.getActiveTaskEditedFiles(), options.currentCwd)
	}

	return lines.join("\n")
}

/**
 * Check whether a value exposes the active task summary interface.
 * @param value Unknown value from a controller.
 * @returns True when the value can be formatted as an active task.
 */
function isActiveTaskSource(value: unknown): value is ActiveTaskSource {
	const candidate = value as Partial<ActiveTaskSource> | undefined
	return (
		candidate !== undefined &&
		typeof candidate.taskId === "string" &&
		typeof candidate.getActiveTaskSummary === "function" &&
		typeof candidate.getActiveTaskPhase === "function" &&
		typeof candidate.getActiveTaskEditedFiles === "function"
	)
}

/**
 * Truncate a task summary to the configured character limit.
 * @param summary Raw task summary.
 * @returns Summary capped at 128 characters with ellipsis when truncated.
 */
function truncateSummary(summary: string): string {
	if (summary.length <= SUMMARY_LIMIT) {
		return summary
	}

	return `${summary.slice(0, SUMMARY_LIMIT - 1)}…`
}

/**
 * Append edited-file lines for one task.
 * @param lines Mutable output lines.
 * @param files Absolute or relative edited file paths.
 * @param currentCwd Current cwd used to produce readable relative paths.
 */
function appendEditedFiles(lines: string[], files: string[], currentCwd: string): void {
	lines.push("  editedFiles:")
	const visibleFiles = files.slice(0, MAX_EDITED_FILES)
	for (const file of visibleFiles) {
		lines.push(`    - ${formatFilePath(file, currentCwd)}`)
	}

	const hiddenCount = files.length - visibleFiles.length
	if (hiddenCount > 0) {
		lines.push(`    - ... ${hiddenCount} more`)
	}
}

/**
 * Format a file path relative to the current cwd when possible.
 * @param file File path to format.
 * @param currentCwd Current working directory.
 * @returns POSIX-style readable path.
 */
function formatFilePath(file: string, currentCwd: string): string {
	const relativePath = path.isAbsolute(file) ? path.relative(currentCwd, file) : file
	return relativePath.replace(/\\/g, "/")
}
