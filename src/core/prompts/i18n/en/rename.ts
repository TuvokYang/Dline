// English prompts for rename tool — key-value pairs only.
const prompts: Record<string, string> = {
	description:
		"Rename a symbol at the given file position using the IDE's LSP (semantic rename). This renames the symbol across all files, distinguishing between symbol references, comments, and string literals. Set dry_run=true to preview changes without applying them. Only available in VSCode; other environments return an error suggesting replace_text or replace_in_file as a fallback.",
	nativeDescription:
		"Rename a symbol at the given file position using the IDE's LSP (semantic rename). Only renames symbol references (definitions, imports, calls); skips string literals, comments, and JSDoc. Set dry_run=true to preview changes without applying them. If LSP returns no edits, the rename could not be performed (language or project may not be supported). Only available in VSCode; for text-level renaming including strings and comments, use replace_text instead.",
	filePathInstruction:
		"Absolute path to the file containing the symbol. Use the exact path as shown in the workspace file listing.",
	filePathUsage: "/path/to/file.ts",
	lineInstruction: "1-based line number where the symbol appears.",
	characterInstruction: "1-based character offset on the line where the symbol starts.",
	newNameInstruction: "The new name for the symbol. Use camelCase/PascalCase/snake_case as appropriate for the language.",
	newNameUsage: "newSymbolName",
	dryRunInstruction: "When true, returns a preview of all changes without actually modifying any files. Defaults to false.",
	// Handler messages
	noLspSupport:
		"LSP support is not available in this environment.\nPlease use replace_text with a text pattern to perform the rename instead. For example: replace_text(find='oldName', replace='newName', file_pattern='*.ts')",
	missingParams: "rename: missing required parameters (file_path, line, character, new_name).",
	noEdits: "rename: LSP returned no edits for this rename.",
	failedApply: "rename: VSCode failed to apply the rename edit.",
	errorPrefix: "rename error:",
	dryRunHeader: '[RENAME PREVIEW] → "{newName}"\nWould modify {files} files, {changes} occurrences:\n',
	dryRunFooter: "No files were modified. Remove dry_run to apply changes.",
	successOutput: 'Renamed symbol to "{newName}".\nModified {files} files, {changes} changes total.',
	fileEditLine: "  L{line}: {original} → {new}",
	fileEditLineApplied: "  L{line}: → {new}",
}
export default prompts
