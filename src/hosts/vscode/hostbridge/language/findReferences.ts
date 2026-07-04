import * as fs from "node:fs"
import * as vscode from "vscode"
import { FindReferencesRequest, FindReferencesResponse, ReferenceLocation } from "@/shared/proto/dline/host/language"
import { Logger } from "@/shared/services/Logger"

/** Command IDs that indicate missing LSP support in the host. */
const LSP_UNAVAILABLE_PATTERNS = ["not found", "not supported", "command 'vscode.executeReferenceProvider'"]

/**
 * Run pre-flight checks before calling the LSP to diagnose why results may be empty.
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
		return `File is not inside any workspace folder. LSP cannot index files outside the workspace: ${uri.fsPath}`
	}

	// Check 3: a language extension is active for this file type
	try {
		const doc = await vscode.workspace.openTextDocument(uri)
		const langId = doc.languageId
		const matchingExts = vscode.extensions.all.filter(
			(e) => e.isActive && e.packageJSON?.contributes?.languages?.some((l: { id: string }) => l.id === langId),
		)
		if (matchingExts.length === 0) {
			return `No active language extension found for '${langId}'. LSP may not be available for this file type.`
		}
	} catch {
		return `Unable to open document for language detection: ${uri.fsPath}`
	}

	return ""
}

/**
 * Find all references to the symbol at the given position using VSCode's LSP.
 * Returns ReferenceLocation[] with context lines for each reference found.
 */
export async function findReferences(request: FindReferencesRequest): Promise<FindReferencesResponse> {
	try {
		const uri = vscode.Uri.file(request.filePath)

		// Run pre-flight checks before calling LSP
		const preCheckError = await runLspPreChecks(uri)
		if (preCheckError) {
			return {
				hasLspSupport: false,
				references: [],
				errorMessage: preCheckError,
			}
		}

		const position = new vscode.Position(request.line - 1, request.character - 1)

		const locations = await vscode.commands.executeCommand<vscode.Location[]>(
			"vscode.executeReferenceProvider",
			uri,
			position,
		)

		if (!locations || locations.length === 0) {
			return {
				hasLspSupport: true,
				references: [],
				errorMessage:
					"LSP returned no references. The symbol may have no references, or the language server may not support reference lookups for this file type.",
			}
		}

		const references: ReferenceLocation[] = await Promise.all(
			locations.map(async (loc) => {
				const contextLine = await readLineAt(loc.uri, loc.range.start.line)
				return {
					filePath: loc.uri.fsPath,
					startLine: loc.range.start.line + 1, // 1-based
					startCharacter: loc.range.start.character + 1, // 1-based
					endLine: loc.range.end.line + 1,
					endCharacter: loc.range.end.character + 1,
					contextLine,
				}
			}),
		)

		return {
			hasLspSupport: true,
			references,
			errorMessage: "",
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const hasLspSupport = !LSP_UNAVAILABLE_PATTERNS.some((p) => message.toLowerCase().includes(p.toLowerCase()))
		Logger.warn(`findReferences failed: ${message}`)
		return {
			hasLspSupport,
			references: [],
			errorMessage: message,
		}
	}
}

/**
 * Read a single line from a document at the given 0-based line index.
 */
async function readLineAt(uri: vscode.Uri, line: number): Promise<string> {
	try {
		const doc = await vscode.workspace.openTextDocument(uri)
		if (line >= 0 && line < doc.lineCount) {
			return doc.lineAt(line).text
		}
	} catch {
		// document may be binary or inaccessible
	}
	return ""
}
