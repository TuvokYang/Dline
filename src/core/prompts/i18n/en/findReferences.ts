// English prompts for find_references tool — key-value pairs only.
const prompts: Record<string, string> = {
	description:
		"Find all semantic references to a symbol at the given file position via the IDE's LSP. Returns file paths, line numbers, and context lines for each reference (definitions, imports, calls). This does NOT find occurrences in string literals, comments, or JSDoc. An empty result may mean the LSP does not support this language or file type, not that no references exist. Use this before renaming or refactoring to understand semantic impact. To search strings and comments, use search_files with regex. Only available in VSCode; other environments return an error suggesting search_files as a fallback.",
	nativeDescription:
		"Find all semantic references to a symbol at the given file position via the IDE's LSP. Returns file paths, line numbers, and context lines for each reference (definitions, imports, calls). This does NOT find occurrences in string literals, comments, or JSDoc. An empty result may mean the LSP does not support this language or file type. To search strings and comments, use search_files with regex. Only available in VSCode.",
	filePathInstruction:
		"Absolute path to the file containing the symbol. Use the exact path as shown in the workspace file listing.",
	filePathUsage: "/path/to/file.ts",
	lineInstruction: "1-based line number where the symbol appears.",
	characterInstruction: "1-based character offset on the line where the symbol starts.",
	// Handler messages
	noLspSupport:
		"LSP support is not available in this environment.\nPlease use search_files with a regex pattern to find references instead. For example: search_files with regex matching the symbol name across the relevant file types.",
	noReferences: "No references found for the symbol.",
	foundReferences: "Found {count} references in the workspace:",
	errorPrefix: "find_references error:",
}
export default prompts
