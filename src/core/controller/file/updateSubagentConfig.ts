/**
 * Handler for updateSubagentConfig RPC.
 *
 * Updates a subagent YAML configuration file in-place.
 * Supports incremental updates: only provided fields are modified.
 * Fields that are omitted (undefined) are left unchanged.
 */
import { Empty } from "@shared/proto/dline/common"
import { UpdateSubagentConfigRequest } from "@shared/proto/dline/file"
import { Logger } from "@shared/services/Logger"
import fs from "fs/promises"
import type { Controller } from ".."

/**
 * Update a subagent YAML config file.
 *
 * Modifies frontmatter fields (modelId, tools, skills, description)
 * while preserving the system prompt body and comments.
 */
export async function updateSubagentConfig(_controller: Controller, request: UpdateSubagentConfigRequest): Promise<Empty> {
	const { subagentPath, modelId, tools, skills, description } = request

	if (!subagentPath) {
		throw new Error("subagentPath is required")
	}

	// Read the current file content
	let content: string
	try {
		content = await fs.readFile(subagentPath, "utf8")
	} catch (err) {
		Logger.error(`[updateSubagentConfig] Failed to read subagent file: ${subagentPath}`, err)
		throw new Error(`Failed to read subagent file: ${subagentPath}`)
	}

	// Find frontmatter boundaries
	const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
	if (!frontmatterMatch) {
		throw new Error(`No YAML frontmatter found in: ${subagentPath}`)
	}

	const frontmatterStart = content.indexOf("---")
	const frontmatterEnd = content.indexOf("---", frontmatterStart + 3) + 3
	const beforeFrontmatter = content.slice(0, frontmatterStart)
	const frontmatterBody = content.slice(frontmatterStart + 3, frontmatterEnd - 3)
	const afterFrontmatter = content.slice(frontmatterEnd)

	let updatedFrontmatter = frontmatterBody

	// Update modelId if provided (set to empty string to remove)
	if (modelId !== undefined) {
		updatedFrontmatter = upsertYamlField(updatedFrontmatter, "modelId", modelId || null)
	}

	// Update tools if provided
	if (tools !== undefined) {
		updatedFrontmatter = upsertYamlListField(updatedFrontmatter, "tools", tools)
	}

	// Update skills if provided
	if (skills !== undefined) {
		updatedFrontmatter = upsertYamlListField(updatedFrontmatter, "skills", skills)
	}

	// Update description if provided
	if (description !== undefined) {
		updatedFrontmatter = upsertYamlField(updatedFrontmatter, "description", description || null)
	}

	// Reconstruct the file
	const newContent = `${beforeFrontmatter}---${updatedFrontmatter}\n---${afterFrontmatter}`

	try {
		await fs.writeFile(subagentPath, newContent, "utf8")
		Logger.log(`[updateSubagentConfig] Updated subagent config: ${subagentPath}`)
	} catch (err) {
		Logger.error(`[updateSubagentConfig] Failed to write subagent file: ${subagentPath}`, err)
		throw new Error(`Failed to write subagent file: ${subagentPath}`)
	}

	return Empty.create({})
}

/**
 * Upsert a scalar YAML field in the frontmatter.
 * If the field exists, replaces its value. If not, appends it.
 * Pass null for value to remove the field.
 */
function upsertYamlField(frontmatter: string, fieldName: string, value: string | null): string {
	const lines = frontmatter.split("\n")
	const fieldRegex = new RegExp(`^\\s*${escapeRegex(fieldName)}\\s*:`)

	// Remove existing field occurrences
	const filtered = lines.filter((line) => !fieldRegex.test(line))

	if (value === null) {
		// Field removed
		return filtered.join("\n")
	}

	// Find insertion point: after the last non-empty line before other fields
	// Simple strategy: append after the last field
	const trimmed = filtered.filter((l) => l.trim() !== "")

	// Insert alphabetically or at end — for simplicity, append at end
	const newLine = `${fieldName}: ${escapeYamlValue(value)}`

	return [...trimmed, newLine].join("\n")
}

/**
 * Upsert a YAML list field in the frontmatter.
 * Replaces the entire list with new values.
 */
function upsertYamlListField(frontmatter: string, fieldName: string, values: string[]): string {
	const lines = frontmatter.split("\n")
	const fieldRegex = new RegExp(`^\\s*${escapeRegex(fieldName)}\\s*:`)

	// Find the start index of the field
	const fieldStartIndex = lines.findIndex((line) => fieldRegex.test(line))
	if (fieldStartIndex === -1) {
		// Field doesn't exist, append
		const newBlock =
			values.length > 0 ? [`${fieldName}:`, ...values.map((v) => `  - ${escapeYamlValue(v)}`)] : [`${fieldName}: []`]
		const nonEmpty = lines.filter((l) => l.trim() !== "")
		return [...nonEmpty, ...newBlock].join("\n")
	}

	// Remove existing field and its list items
	const beforeLines = lines.slice(0, fieldStartIndex)
	const afterStart = lines.slice(fieldStartIndex + 1)

	// Find where the list ends (next top-level field or end of frontmatter)
	let listEndIndex = 0
	for (let i = 0; i < afterStart.length; i++) {
		const line = afterStart[i]
		// List items start with "  - " or spaces
		if (line.match(/^\s{2}-\s/) || line.match(/^\s{4,}/)) {
			continue
		}
		// Top-level field found — list ends
		if (line.match(/^\s*\w+\s*:/) && !line.match(/^\s{2,}/)) {
			listEndIndex = i
			break
		}
		listEndIndex = i + 1
	}

	const afterLines = afterStart.slice(listEndIndex)

	// Build new list block
	const newBlock =
		values.length > 0 ? [`${fieldName}:`, ...values.map((v) => `  - ${escapeYamlValue(v)}`)] : [`${fieldName}: []`]

	return [...beforeLines, ...newBlock, ...afterLines].join("\n")
}

/**
 * Escape a string value for YAML single-line usage.
 */
function escapeYamlValue(value: string): string {
	// If value contains special characters, wrap in quotes
	if (/[:{}[\],&*?|!<>'"@`#]/.test(value) || value.includes(" ") || value === "") {
		return `"${value.replace(/"/g, '\\"')}"`
	}
	return value
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
