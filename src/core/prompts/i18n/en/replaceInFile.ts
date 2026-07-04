// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Request to edit an existing file using SEARCH/REPLACE blocks. PREFER this tool for all edits to existing files. Only use write_to_file for creating new files.",
	nativeDescription:
		"[IMPORTANT: Always output the absolutePath first] Request to edit an existing file using SEARCH/REPLACE blocks. PREFER this tool for all edits to existing files. Only use write_to_file for creating new files.",
	pathInstruction: `The path of the file to modify (relative to the current working directory {{CWD}})`,
	pathUsage: "File path here",
	nativePathInstruction: "The absolute path to the file to write to.",
	baseDiffInstructions: `One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section
   5. If your source context came from read_file and includes line labels (for example, "42 | const x = 1"), do NOT include the "42 | " prefix in SEARCH or REPLACE content. Match only the raw file text.
   6. DELIMITER CONFLICT: If any line in your SEARCH content starts with 7+ dashes followed by " SEARCH", or is exactly 7+ "=" signs, or starts with 7+ "+" followed by " REPLACE", change your delimiter count to a unique value (>= 7). The count must not match any content line format. All three markers within a block must use the same count.
   7. FAILURE RECOVERY: If SEARCH block fails to match:
      - The match text may be too short, causing multiple identical matches in the file. Read the file with read_file, select a longer unique snippet around the target lines, and retry.
      - The match text may not exist exactly in the file due to character differences, whitespace, or indentation. Read the file and copy/paste the EXACT text you need to match.
      - NEVER use command-line tools (sed, awk, ripgrep, etc.) to edit files. Only use replace_in_file for editing existing files.
      - Always re-read the file before retrying after a failed match.`,
	notebookInstructions: `
   7. For Jupyter Notebook (.ipynb) files:
     * Match the exact JSON structure including quotes, commas, and \\n characters
     * Each line in "source" array (except last) must end with "\\n"
     * Each source line is a separate JSON string in the array
     * Example SEARCH block for notebook:
       ------- SEARCH
         "source": [
           "x = 10\\n",
           "print(x)"
         ]
       =======
         "source": [
           "x = 100\\n",
           "print(x)"
         ]
       +++++++ REPLACE`,
	diffUsage: "Search and replace blocks here",
}
export default prompts
