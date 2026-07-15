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
	replaceInFileMissingDiffError: `Failed to edit '@REL_PATH@': The 'diff' parameter was empty.

The diff parameter must contain SEARCH/REPLACE blocks in this format:
------- SEARCH
exact lines to find
=======
replacement lines
+++++++ REPLACE

Rules:
- The SEARCH block must match existing file content exactly (including whitespace and indentation)
- You can include multiple SEARCH/REPLACE blocks in a single diff parameter
- If you're unsure of the exact content, use read_file first to see the current file
- If the diff was not empty but the operation still failed, the failure is ALWAYS because the SEARCH block did not match the file content exactly. You MUST re-read the file with read_file and copy/paste the exact text - never guess or reconstruct from memory.`,
	diffErrorReminder: `The SEARCH block failed to match the file content. Diagnose:
1. Stale context - file modified since last read. Re-read with read_file.
2. Imprecise match - whitespace/indentation/character differences. Copy EXACT text.
3. Character confusion - em-dash vs hyphen, curly vs straight quotes.

Fix: re-read the file, then copy/paste exact lines. 
Do NOT guess or reconstruct content from memory.
Do NOT add extra characters to the markers. 
Do NOT modify the marker format.
Do NOT use CLI tools to edit files.

The correct SEARCH/REPLACE block format is:
------- SEARCH
exact content to find
=======
new content to replace with
+++++++ REPLACE

IMPORTANT: The ======= separator line must be EXACTLY that — equals signs only, with nothing else on the line.
Do NOT write "======= REPLACE" — that will cause a malformatted error.
Only the final +++++++ REPLACE marker includes the word REPLACE.`,
	diffExtraCloseMarker: `Unexpected +++++++ REPLACE close marker without a preceding ------- SEARCH block.
Remove the extra close marker or ensure it follows a complete SEARCH/REPLACE block.`,
	diffNestedSearchMarker: `Nested ------- SEARCH marker found inside SEARCH content.
This usually means the previous SEARCH block was not properly closed.
Ensure each SEARCH/REPLACE block is complete before starting a new one.`,
	diffMissingSeparator: `Missing ======= separator in SEARCH/REPLACE block.
The block has a ------- SEARCH marker and a +++++++ REPLACE marker but no ======= separator.
Add the separator line between the SEARCH content and the REPLACE content.`,
	diffSearchNotFound: `SEARCH content (@LINE_COUNT@ lines) was not found in the file.
Diagnose:
1. Re-read the file with read_file to get the exact current content.
2. Copy/paste the EXACT text from the file — character-for-character.
3. Check whitespace, indentation, and line endings.
4. The SEARCH block must match content in file order (after previous replacements).`,
	diffEmptySearchNonemptyFile: `Empty SEARCH block with a non-empty file.
Use an empty SEARCH block only for creating new files. For existing files, provide the exact content to find and replace.`,
	diffEmptySearchContentConflict: `Empty SEARCH block detected — SEARCH content may conflict with delimiter format.
The SEARCH content line was treated as the ======= separator because it has the same number of characters.
Use a higher delimiter count (>= 7) for all three markers to distinguish content from delimiters.`,
	diffDelimiterTooShort: `Delimiter count @COUNT@ is below the minimum of 7.
Use at least 7 characters for all SEARCH/REPLACE markers. Example:
------- SEARCH
=======
+++++++ REPLACE`,
	diffSearchMarkerInReplace: `Found ------- SEARCH marker inside REPLACE content.
This indicates a malformed SEARCH/REPLACE block — a new SEARCH block started before the previous one was closed.
Close the current block with +++++++ REPLACE before starting a new block.`,
	diffDelimiterConflict: `Delimiter conflict: @BLOCK_TYPE@ content contains a line with @COUNT@ '@CHAR@' characters matching the delimiter.
Use a different delimiter count (e.g. 8 or 9) to avoid this conflict. Example:
-------- SEARCH
========
++++++++ REPLACE`,
	diffDelimiterMismatch: `Delimiter count mismatch: SEARCH marker used @SEARCH_N@ characters but close marker used @CLOSE_N@ characters.
All markers in a block must use the same number of delimiter characters.`,
	diffUnclosedSearch: `SEARCH block was not closed — missing ======= separator.
When the diff stream ended, the parser was still inside a SEARCH block.
Ensure every ------- SEARCH is followed by ======= and +++++++ REPLACE.`,
	diffUnclosedReplace: `REPLACE block was not closed — missing +++++++ REPLACE marker.
When the diff stream ended, the parser was still inside a REPLACE block.
Ensure every REPLACE section ends with +++++++ REPLACE.`,
	diffBlockOverlap: `Block #@BLOCK_INDEX@ overlaps with block #@PREV_INDEX@.
SEARCH blocks must be in ascending file position order with no overlapping ranges.
Check that each SEARCH block references content after the previous replacement.`,
	diffBlockOutOfOrder: `Block #@BLOCK_INDEX@ is out of file position order.
SEARCH blocks must match content in the order it appears in the file (ascending line numbers).`,
	diffFinalValidation: `Final validation of the SEARCH/REPLACE diff failed.
The diff structure appears correct but the content cannot be applied to the file.
Re-read the file and verify the exact content of each SEARCH block.`,
}
export default prompts
