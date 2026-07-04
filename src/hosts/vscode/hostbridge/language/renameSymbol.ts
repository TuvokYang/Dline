import * as fs from "node:fs"
import * as vscode from "vscode"
import { FileEdit, RenameSymbolRequest, RenameSymbolResponse, TextEdit } from "@/shared/proto/dline/host/language"
import { Logger } from "@/shared/services/Logger"

/** Command IDs that indicate missing LSP support in the host. */
const LSP_UNAVAILABLE_PATTERNS = ["not found", "not supported", "command 'vscode.executeDocumentRenameProvider'"]

/**
 * Run pre-flight checks before calling the LSP to diagnose why rename may fail.
 * Returns an error message string, or empty string if all checks pass.
 */
async function runLspPreChecks(uri: vscode.Uri): Promise<string> {
	// Check 1: file exists on disk
	try {
		await fs.promises.access(uri.fsPath, fs.constants.R_OK)
	} catch {
		return `File not found or not readable: ${uri.fsPath}`
	}

	// Check 2: file belongs to a workspace folder
	const wsFolder = vscode.workspace.getWorkspaceFolder(uri)
	if (!wsFolder) {
		return `File is not inside any workspace folder. LSP cannot rename symbols outside the workspace: ${uri.fsPath}`
	}

	// Check 3: a language extension is active for this file type
	try {
		const doc = await vscode.workspace.openTextDocument(uri)
		const langId = doc.languageId
		const matchingExts = vscode.extensions.all.filter(
			(e) => e.isActive && e.packageJSON?.contributes?.languages?.some((l: { id: string }) => l.id === langId),
		)
		if (matchingExts.length === 0) {
			return `No active language extension found for '${langId}'. LSP rename may not be available for this file type.`
		}
	} catch {
		return `Unable to open document for language detection: ${uri.fsPath}`
	}

	return ""
}

/**
 * Rename the symbol at the given position using VSCode's LSP.
 * When dry_run is true, returns a preview without applying changes.
 */
export async function renameSymbol(request: RenameSymbolRequest): Promise<RenameSymbolResponse> {
	try {
		const uri = vscode.Uri.file(request.filePath)

		// Run pre-flight checks before calling LSP
		const preCheckError = await runLspPreChecks(uri)
		if (preCheckError) {
			return {
				success: false,
				filesChanged: 0,
				totalChanges: 0,
				hasLspSupport: false,
				errorMessage: preCheckError,
				preview: [],
			}
		}

		const position = new vscode.Position(request.line - 1, request.character - 1)

		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
			"vscode.executeDocumentRenameProvider",
			uri,
			position,
			request.newName,
		)

		if (!edit || edit.size === 0) {
			return {
				success: false,
				filesChanged: 0,
				totalChanges: 0,
				hasLspSupport: true,
				errorMessage:
					"LSP returned no edits for this rename. The symbol may not be renamable, or the language server may not support rename for this file type.",
				preview: [],
			}
		}

		const fileEdits = workspaceEditToFileEdits(edit)
		const totalChanges = fileEdits.reduce((sum, fe) => sum + fe.edits.length, 0)
		// Fill oldLine/newLine from disk for every edit (LSP does not provide line content)
		fillLineText(fileEdits, request.newName)

		if (request.dryRun) {
			return {
				success: true,
				filesChanged: fileEdits.length,
				totalChanges,
				hasLspSupport: true,
				errorMessage: "",
				preview: fileEdits,
			}
		}

		// Apply the workspace edit
		const applied = await vscode.workspace.applyEdit(edit)
		if (!applied) {
			return {
				success: false,
				filesChanged: 0,
				totalChanges: 0,
				hasLspSupport: true,
				errorMessage: "VSCode failed to apply the rename edit.",
				preview: [],
			}
		}

		// Save all modified documents to disk
		for (const [uri] of edit.entries()) {
			const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
			if (doc) await doc.save()
		}

		return {
			success: true,
			filesChanged: fileEdits.length,
			totalChanges,
			hasLspSupport: true,
			errorMessage: "",
			preview: fileEdits,
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const hasLspSupport = !LSP_UNAVAILABLE_PATTERNS.some((p) => message.toLowerCase().includes(p.toLowerCase()))
		Logger.warn(`renameSymbol failed: ${message}`)
		return {
			success: false,
			filesChanged: 0,
			totalChanges: 0,
			hasLspSupport,
			errorMessage: message,
			preview: [],
		}
	}
}

/**
 * Convert a VSCode WorkspaceEdit into FileEdit[] for the proto response.
 * originalText is left empty — fillOriginalText() populates it afterward.
 */
function workspaceEditToFileEdits(edit: vscode.WorkspaceEdit): FileEdit[] {
	const fileEdits: FileEdit[] = []

	for (const [uri, edits] of edit.entries()) {
		const textEdits: TextEdit[] = []
		for (const e of edits) {
			textEdits.push({
				startLine: e.range.start.line + 1,
				startCharacter: e.range.start.character + 1,
				endLine: e.range.end.line + 1,
				endCharacter: e.range.end.character + 1,
				newText: e.newText,
				originalText: "",
				oldLine: "",
				newLine: "",
			})
		}

		fileEdits.push({
			filePath: uri.fsPath,
			edits: textEdits,
		})
	}

	return fileEdits
}

/**
 * Fill oldLine and newLine for every TextEdit by reading source lines from disk
 * and constructing the renamed line.
 */
function fillLineText(fileEdits: FileEdit[], newName: string): void {
	for (const file of fileEdits) {
		let lines: string[] | null = null
		for (const edit of file.edits) {
			if (!lines) {
				try {
					lines = fs.readFileSync(file.filePath, "utf-8").split("\n")
				} catch {
					break
				}
			}
			const lineIdx = edit.startLine - 1
			if (lineIdx >= 0 && lineIdx < lines.length) {
				const origLine = lines[lineIdx]
				edit.oldLine = origLine
				edit.originalText = origLine.substring(edit.startCharacter - 1, edit.endCharacter - 1)
				edit.newLine = buildRenamedLine(origLine, edit.startCharacter, edit.endCharacter, newName)
			}
		}
	}
}

/**
 * Replace the character range [startChar, endChar] (1-based) with newName.
 */
function buildRenamedLine(origLine: string, startChar: number, endChar: number, newName: string): string {
	const s = startChar - 1
	const e = endChar - 1
	return origLine.substring(0, s) + newName + origLine.substring(e)
}
