import crypto from "node:crypto"
import fs from "fs/promises"
import { fileExistsAtPath } from "@/utils/fs"

/**
 * JSONL (JSON Lines) utility functions for incremental storage.
 *
 * Replaces full-array JSON read/write with line-by-line JSONL format,
 * enabling append-only writes and streaming reads for large datasets.
 *
 * Legacy JSON array files are detected and parsed on read, but NOT overwritten.
 * The original file is preserved as a natural backup. New data is written
 * to .jsonl files exclusively.
 */

const TRIM_START_REGEX = /^\s+/
const ATOMIC_RENAME_MAX_ATTEMPTS = 3
const ATOMIC_RENAME_RETRY_DELAYS_MS = [10, 25] as const
const RETRYABLE_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])

async function renameAtomicFile(sourcePath: string, destinationPath: string): Promise<void> {
	for (let attempt = 1; attempt <= ATOMIC_RENAME_MAX_ATTEMPTS; attempt++) {
		try {
			await fs.rename(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_ATOMIC_RENAME_CODES.has(code) || attempt === ATOMIC_RENAME_MAX_ATTEMPTS) {
				throw error
			}
			await new Promise<void>((resolve) => setTimeout(resolve, ATOMIC_RENAME_RETRY_DELAYS_MS[attempt - 1] ?? 0))
		}
	}
}

/** Check whether file content is a JSON array (starts with '[' after whitespace). */
function isJsonArray(content: string): boolean {
	return content.replace(TRIM_START_REGEX, "").startsWith("[")
}

/**
 * Read a JSONL file and return parsed entries as an array.
 * Supports both JSONL format (one JSON object per line) and legacy
 * JSON array format. Legacy files are parsed but NOT modified —
 * they serve as natural backups.
 *
 * @param filePath Absolute path to the JSONL/JSON file
 * @returns Parsed entries (empty array if file does not exist)
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
	if (!(await fileExistsAtPath(filePath))) {
		return []
	}

	const content = await fs.readFile(filePath, "utf8")

	// Empty file
	if (!content.trim()) {
		return []
	}

	// Legacy JSON array — parse directly, do NOT overwrite the original file
	if (isJsonArray(content)) {
		try {
			const parsed = JSON.parse(content)
			return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T]
		} catch {
			return []
		}
	}

	// JSONL: one JSON object per line
	return parseJsonlContent<T>(content)
}

/**
 * Append one or more entries as JSONL lines to a file.
 * Creates the file if it does not exist.
 *
 * @param filePath Absolute path to the JSONL file
 * @param entries Entry or entries to append
 */
export async function appendJsonl<T>(filePath: string, entries: T | T[]): Promise<void> {
	const items = Array.isArray(entries) ? entries : [entries]
	if (items.length === 0) return

	const lines = `${items.map((item) => JSON.stringify(item)).join("\n")}\n`
	await fs.appendFile(filePath, lines, "utf8")
}

/**
 * Write the full array as JSONL with atomic write-then-rename.
 * Prevents file truncation on crash compared to direct fs.writeFile.
 *
 * @param filePath Absolute path to the JSONL file
 * @param entries Full array to write
 */
export async function writeJsonl<T>(filePath: string, entries: T[]): Promise<void> {
	const lines = entries.map((item) => JSON.stringify(item)).join("\n")
	const content = lines ? `${lines}\n` : ""
	const tmpPath = `${filePath}.tmp.${crypto.randomUUID()}`
	await fs.writeFile(tmpPath, content, "utf8")
	try {
		await renameAtomicFile(tmpPath, filePath)
	} catch (renameErr) {
		// Best-effort cleanup: if rename fails, remove the orphaned temp file
		try {
			await fs.unlink(tmpPath)
		} catch {
			// ignore unlink errors
		}
		throw renameErr
	}
}

/**
 * Parse JSONL content into an array of entries.
 * Skips empty lines gracefully.
 *
 * @param content Raw JSONL file content
 * @returns Parsed entries
 */
function parseJsonlContent<T>(content: string): T[] {
	const results: T[] = []
	const lines = content.split("\n")
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			results.push(JSON.parse(trimmed) as T)
		} catch {
			// Skip malformed lines silently — preserves as much data as possible
		}
	}
	return results
}
