import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { getReadablePath } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class RenameSymbolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.RENAME

	getDescription(block: ToolUse): string {
		return `[rename] ${(block.params as any)?.new_name || "?"}`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) return
		const params = block.params as Record<string, unknown> | undefined
		const rawPath = String(params?.file_path || "")
		const newName = String(params?.new_name || "")
		await uiHelpers.say(
			"tool",
			JSON.stringify({
				tool: "renameSymbol",
				path: getReadablePath(config.cwd, rawPath),
				regex: newName,
				operationIsLocatedInWorkspace: true,
			}),
			undefined,
			undefined,
			true,
			block.ts,
		)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const p = block.params as Record<string, unknown> | undefined
		const filePath = String(p?.file_path || "")
		const line = Number(p?.line || 0)
		const character = Number(p?.character || 0)
		const newName = String(p?.new_name || "")
		const dryRun = p?.dry_run === true || p?.dry_run === "true"
		const errMsg = (msg: string) => {
			config.callbacks
				.say(
					"tool",
					JSON.stringify({
						tool: "renameSymbol",
						path: getReadablePath(config.cwd, filePath),
						content: msg,
						operationIsLocatedInWorkspace: true,
					}),
					undefined,
					undefined,
					false,
					block.ts,
				)
				.catch(() => {})
			return msg
		}
		if (!filePath || !line || !character || !newName) return errMsg("Error: missing required parameters.")

		try {
			const r = await HostProvider.language.renameSymbol({ filePath, line, character, newName, dryRun })
			if (!r.hasLspSupport) return errMsg("Error: LSP not available. Use replace_text instead.")
			if (r.errorMessage) return errMsg(`Error: ${r.errorMessage}`)
			if (!r.success) return errMsg("Error: rename failed. No edits returned by LSP.")

			// Track all modified files for per-file checkpointing (non-dry-run only)
			if (!dryRun) {
				for (const file of r.preview || []) {
					// Resolve to absolute path using workspace cwd as base, since
					// LSP may return workspace-relative paths.
					const absPath = path.resolve(config.cwd, file.filePath)
					config.services.taskFileTracker.trackModification(absPath)
				}
			}

			const oldName = r.preview?.[0]?.edits?.[0]?.originalText || ""
			// Build structured match entries from LSP preview
			const matchEntries: Array<{
				file: string
				line: number
				column: number
				originalText: string
				newText: string
				diff: string
			}> = []
			for (const file of r.preview || []) {
				const rel = getReadablePath(config.cwd, file.filePath)
				for (const edit of file.edits) {
					matchEntries.push({
						file: rel,
						line: edit.startLine,
						column: edit.startCharacter,
						originalText: edit.originalText || oldName,
						newText: newName,
						diff: `- ${edit.oldLine}\n+ ${edit.newLine}`,
					})
				}
			}
			const diff = matchEntries.map((m) => m.diff).join("\n")
			const content = buildContent(config.cwd, oldName, newName, dryRun, r.filesChanged, r.totalChanges, r.preview)
			config.callbacks
				.say(
					"tool",
					JSON.stringify({
						tool: "renameSymbol",
						path: getReadablePath(config.cwd, filePath),
						regex: newName,
						diff,
						matches: matchEntries,
						files: r.filesChanged,
						count: r.totalChanges,
						dryRun,
						content,
						operationIsLocatedInWorkspace: true,
					}),
					undefined,
					undefined,
					false,
					block.ts,
				)
				.catch(() => {})
			return content
		} catch (e) {
			return errMsg(`Error: ${e}`)
		}
	}
}

function buildContent(
	cwd: string,
	oldName: string,
	newName: string,
	dryRun: boolean,
	filesChanged: number,
	totalChanges: number,
	preview?: Array<{
		filePath: string
		edits: Array<{ startLine: number; startCharacter: number; newText: string; originalText: string }>
	}>,
): string {
	let out = `Rename: ${oldName} -> ${newName} (${filesChanged} files, ${totalChanges} changes)${dryRun ? " (preview)" : ""}\n`
	if (!preview) return out
	for (const file of preview) {
		const rel = getReadablePath(cwd, file.filePath)
		for (const edit of file.edits) {
			out += `\n${rel} L${edit.startLine}:${edit.startCharacter}\n  ${edit.originalText || oldName}\n  ${edit.newText}\n`
		}
	}
	if (dryRun) out += `\nNo files were modified. Remove dry_run to apply changes.`
	return out
}
