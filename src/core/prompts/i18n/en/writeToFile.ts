// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Request to write content to a NEW file at the specified path. Use this tool ONLY for creating files that do not already exist. For editing existing files, always use replace_in_file. This tool will automatically create any directories needed to write the file.",
	nativeDescription:
		"[IMPORTANT: Always output the absolutePath first] Request to write content to a NEW file at the specified path. Use this tool ONLY for creating files that do not already exist. For editing existing files, always use replace_in_file. This tool will automatically create any directories needed to write the file.",
	pathInstruction: `The path of the file to write to (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
	pathUsage: "File path here",
	nativePathInstruction: "The absolute path to the file to write to.",
	contentInstruction:
		"The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified.",
	contentUsage: "Your file content here",
	nativeContentInstruction:
		"After providing the path so a file can be created, then use this to provide the content to write to the file.",
	diffMatchFailed:
		"Blank result -- the SEARCH text did not match anything in the file. Re-read the file and try again with the exact current content.",
}
export default prompts
