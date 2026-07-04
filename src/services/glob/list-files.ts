import { workspaceResolver } from "@core/workspace"
import { isDirectory } from "@utils/fs"
import { arePathsEqual } from "@utils/path"
import * as fs from "fs/promises"
import { globby, Options } from "globby"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

/**
 * File metadata returned by listFiles after enhancement.
 */
export interface FileInfo {
	/** Absolute path to the file or directory */
	path: string
	/** File size in bytes (0 for directories) */
	size: number
	/** Last modification time */
	mtime: Date
	/** Whether this entry is a directory */
	isDirectory: boolean
	/** Line count for text files (undefined for directories and binary files) */
	lineCount?: number
}

// Maximum file size in bytes to attempt line counting (1 MB)
const MAX_LINE_COUNT_FILE_SIZE = 1_000_000

// Constants
const DEFAULT_IGNORE_DIRECTORIES = [
	"node_modules",
	"__pycache__",
	"env",
	"venv",
	"target/dependency",
	"build/dependencies",
	"dist",
	"out",
	"bundle",
	"vendor",
	"tmp",
	"temp",
	"deps",
	"Pods",
]

// Helper functions
function isRestrictedPath(absolutePath: string): boolean {
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	const isRoot = arePathsEqual(absolutePath, root)
	if (isRoot) {
		return true
	}

	const homeDir = os.homedir()
	const isHomeDir = arePathsEqual(absolutePath, homeDir)
	if (isHomeDir) {
		return true
	}

	return false
}

function isTargetingHiddenDirectory(absolutePath: string): boolean {
	const dirName = workspaceResolver.getBasename(absolutePath, "Services.glob.isTargetingHiddenDirectory")
	return dirName.startsWith(".")
}

/**
 * Read a .gitignore file and convert its patterns to glob ignore patterns.
 *
 * We do NOT use globby's built-in `gitignore: true` option because it recursively
 * reads ALL .gitignore files in the entire directory tree upfront - including those
 * inside directories that are themselves gitignored. In projects with large gitignored
 * directories containing many nested repos (each with their own .gitignore), this
 * causes V8 to run out of memory during regex compilation, crashing the extension host.
 *
 * Instead, we read .gitignore files incrementally during BFS traversal: only from
 * directories we actually enter (which are not ignored), never from ignored directories.
 */
async function readGitignorePatterns(dirPath: string): Promise<string[]> {
	try {
		const gitignorePath = path.join(dirPath, ".gitignore")
		const content = await fs.readFile(gitignorePath, "utf8")
		const patterns: string[] = []

		for (const line of content.split("\n")) {
			const trimmed = line.trim()
			// Skip empty lines and comments
			if (!trimmed || trimmed.startsWith("#")) {
				continue
			}
			// Skip negation patterns - they're complex to convert and rarely
			// critical for the directory listing use case
			if (trimmed.startsWith("!")) {
				continue
			}
			// Convert gitignore patterns to glob ignore patterns
			if (trimmed.endsWith("/")) {
				// Directory pattern: "ignored-dir/" → match the directory itself and its contents.
				// Two explicit patterns avoid ambiguity across glob library versions:
				const dirName = trimmed.slice(0, -1)
				patterns.push(`**/${dirName}`)
				patterns.push(`**/${dirName}/**`)
			} else {
				// File or ambiguous pattern: "*.log" -> "**/*.log" and "**/*.log/**"
				patterns.push(`**/${trimmed}`)
				patterns.push(`**/${trimmed}/**`)
			}
		}

		return patterns
	} catch {
		return []
	}
}

async function buildIgnorePatterns(absolutePath: string): Promise<string[]> {
	const isTargetHidden = isTargetingHiddenDirectory(absolutePath)

	const patterns = [...DEFAULT_IGNORE_DIRECTORIES]

	// Only ignore hidden directories if we're not explicitly targeting a hidden directory
	if (!isTargetHidden) {
		patterns.push(".*")
	}

	const globPatterns = patterns.map((dir) => `**/${dir}/**`)

	// Read root .gitignore to seed the initial ignore patterns.
	// Additional .gitignore files from subdirectories are read incrementally
	// during BFS traversal in globbyLevelByLevel().
	const gitignorePatterns = await readGitignorePatterns(absolutePath)
	globPatterns.push(...gitignorePatterns)

	return globPatterns
}

/**
 * Enrich raw file paths with stat metadata (size, mtime, isDirectory).
 * Uses Promise.allSettled for concurrent stat calls with graceful error handling.
 */
async function enrichWithStat(filePaths: string[]): Promise<FileInfo[]> {
	const results = await Promise.allSettled(
		filePaths.map(async (filePath) => {
			const isDir = filePath.endsWith("/")
			try {
				const stats = await fs.stat(filePath)
				return {
					path: filePath,
					size: stats.size,
					mtime: stats.mtime,
					isDirectory: isDir || stats.isDirectory(),
					lineCount: undefined, // populated later if applicable
				} satisfies FileInfo
			} catch {
				// File may have been deleted or is inaccessible
				return {
					path: filePath,
					size: 0,
					mtime: new Date(0),
					isDirectory: isDir,
					lineCount: undefined,
				} satisfies FileInfo
			}
		}),
	)

	return results
		.filter((r) => r.status === "fulfilled")
		.map((r) => (r as PromiseFulfilledResult<FileInfo>).value)
}

/**
 * Count lines in a text file.
 * Skips files larger than MAX_LINE_COUNT_FILE_SIZE and likely binary files.
 */
async function countLines(filePath: string): Promise<number | undefined> {
	try {
		const stats = await fs.stat(filePath)
		// Skip large files and directories
		if (stats.isDirectory() || stats.size > MAX_LINE_COUNT_FILE_SIZE) {
			return undefined
		}
		// Skip files with no content
		if (stats.size === 0) {
			return 0
		}
		const content = await fs.readFile(filePath, "utf8")
		// Check for null bytes (binary indicator) — skip binary files
		if (content.includes("\0")) {
			return undefined
		}
		// Count newlines: files ending with \n have that many lines,
		// files without trailing \n have newline count + 1
		const newlineCount = (content.match(/\n/g) || []).length
		return content.endsWith("\n") || newlineCount === 0 ? newlineCount : newlineCount + 1
	} catch {
		return undefined
	}
}

/**
 * Enrich file entries with line counts for text files.
 * Only runs when showLineCount is true (typically for non-recursive listings).
 * Uses concurrent reads for performance but limits concurrency implicitly
 * via Promise.allSettled on the entire array.
 */
async function enrichWithLineCounts(infos: FileInfo[]): Promise<FileInfo[]> {
	const results = await Promise.allSettled(
		infos.map(async (info) => {
			if (info.isDirectory) {
				return info
			}
			const lineCount = await countLines(info.path)
			return { ...info, lineCount }
		}),
	)
	return results
		.filter((r) => r.status === "fulfilled")
		.map((r) => (r as PromiseFulfilledResult<FileInfo>).value)
}

export async function listFiles(dirPath: string, recursive: boolean, limit: number): Promise<[FileInfo[], boolean]> {
	const absolutePathResult = workspaceResolver.resolveWorkspacePath(dirPath, "", "Services.glob.listFiles")
	const absolutePath = typeof absolutePathResult === "string" ? absolutePathResult : absolutePathResult.absolutePath

	// Do not allow listing files in root or home directory
	if (isRestrictedPath(absolutePath)) {
		return [[], false]
	}

	// globby requires cwd to point to a directory
	if (!(await isDirectory(absolutePath))) {
		return [[], false]
	}

	const options: Options = {
		cwd: absolutePath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true, // Append a / on any directories matched
		gitignore: false, // We handle .gitignore ourselves incrementally during BFS to avoid OOM
		ignore: recursive ? await buildIgnorePatterns(absolutePath) : undefined,
		onlyFiles: false, // include directories in results
		suppressErrors: true,
	}

	const filePaths = recursive ? await globbyLevelByLevel(limit, options) : (await globby("*", options)).slice(0, limit)

	// Enrich all file paths with stat metadata
	let fileInfos = await enrichWithStat(filePaths)

	// Count lines for non-recursive listings (performance: avoid I/O avalanche on deep trees)
	if (!recursive) {
		fileInfos = await enrichWithLineCounts(fileInfos)
	}

	return [fileInfos, filePaths.length >= limit]
}

/*
Breadth-first traversal of directory structure level by level up to a limit:
   - Queue-based approach ensures proper breadth-first traversal
   - Processes directory patterns level by level
   - Captures a representative sample of the directory structure up to the limit
   - Minimizes risk of missing deeply nested files
   - Reads .gitignore files incrementally from each non-ignored directory entered,
     avoiding the OOM crash caused by globby's gitignore:true reading ALL nested
     .gitignore files upfront (including those inside gitignored directories)

- Notes:
   - Relies on globby to mark directories with /
   - Potential for loops if symbolic links reference back to parent (we could use followSymlinks: false but that may not be ideal for some projects and it's pointless if they're not using symlinks wrong)
   - Timeout mechanism prevents infinite loops
*/
async function globbyLevelByLevel(limit: number, options?: Options) {
	const results: Set<string> = new Set()
	const queue: string[] = ["*"]
	// Track all ignore patterns, starting with whatever was passed in options.
	// We'll add patterns from .gitignore files as we discover non-ignored directories.
	const currentIgnore: string[] = [...((options?.ignore as string[]) ?? [])]

	const globbingProcess = async () => {
		while (queue.length > 0 && results.size < limit) {
			const pattern = queue.shift()!
			// Use current accumulated ignore patterns for each globby call
			const currentOptions = { ...options, ignore: currentIgnore }
			const filesAtLevel = await globby(pattern, currentOptions)

			for (const file of filesAtLevel) {
				if (results.size >= limit) {
					break
				}
				results.add(file)
				if (file.endsWith("/")) {
					// This directory passed the ignore filters, so it's not gitignored.
					// Read its .gitignore (if any) and add patterns to the ignore list
					// so deeper traversal respects them.
					const dirGitignorePatterns = await readGitignorePatterns(file)
					if (dirGitignorePatterns.length > 0) {
						currentIgnore.push(...dirGitignorePatterns)
					}

					// Queue as a RELATIVE path to cwd so that ignore patterns (like **/tmp/**)
					// are checked against relative entry paths, not absolute ones. Using absolute
					// patterns causes false matches when the project is under a directory whose
					// name collides with DEFAULT_IGNORE_DIRECTORIES (e.g., /tmp on Linux).
					const cwd = options?.cwd?.toString() ?? ""
					const relativeDir = path.relative(cwd, file)
					// Escape backslashes and parentheses in the path to prevent glob pattern interpretation.
					// This is crucial for NextJS folder naming conventions which use parentheses like (auth), (dashboard).
					// Without escaping, glob treats backslashes as escapes and parentheses as special pattern grouping characters.
					const escapedDir = relativeDir
						.replace(/\\/g, "\\\\")
						.replace(/\(/g, "\\(")
						.replace(/\)/g, "\\)")
					queue.push(`${escapedDir}/*`)
				}
			}
		}
		return Array.from(results).slice(0, limit)
	}

	// Timeout after 10 seconds and return partial results
	const timeoutPromise = new Promise<string[]>((_, reject) => {
		setTimeout(() => reject(new Error("Globbing timeout")), 10_000)
	})
	try {
		return await Promise.race([globbingProcess(), timeoutPromise])
	} catch (_error) {
		Logger.warn("Globbing timed out, returning partial results")
		return Array.from(results)
	}
}
