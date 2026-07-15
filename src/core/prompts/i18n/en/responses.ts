// English response prompts — key-value pairs only, no code logic.
// Imported and registered by i18n/index.ts.

const prompts: Record<string, string> = {
	toolDenied: "The user denied this operation.",
	toolError: "The tool execution failed with the following error:\n<error>\n@ERROR@\n</error>",
	clineIgnoreError:
		"Access to @PATH@ is blocked by the .clineignore file settings. You must try to continue in the task without using this file, or ask the user to update the .clineignore file.",
	permissionDeniedError:
		"Command execution blocked by DLINE_COMMAND_PERMISSIONS: @REASON@. You must try a different approach or ask the user to update the permission settings.",
	noToolsUsed: `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

@TOOL_REMINDER@

# Next Steps

If you have completed the user's task, use the attempt_completion tool. 
If you require additional information from the user, use the ask_followup_question tool. 
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. 
(This is an automated message, so do not respond to it conversationally.)`,
	tooManyMistakes:
		"You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n@FEEDBACK@\n</feedback>",
	missingToolParameterError:
		"Missing value for required parameter '@PARAM_NAME@'. Please retry with complete response.\n\n@TOOL_REMINDER@",
	toolAlreadyUsed:
		"Tool [@TOOL_NAME@] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.",
	repeatedToolCall:
		"Tool [@TOOL_NAME@] has been called @COUNT@ times consecutively with identical arguments. This is not making progress. Please use a different tool or different arguments instead of repeating the same call.",
	duplicateFileReadNotice:
		"[[NOTE] This file read has been removed to save space in the context window. Refer to the latest file read for the most up to date version of this file.]",
	contextTruncationNotice:
		"[NOTE] Some previous conversation history with the user has been removed to maintain optimal context window length. The initial user task has been retained for continuity, while intermediate conversation history has been removed. Keep this in mind as you continue assisting the user. Pay special attention to the user's latest messages.",
	continueAssisting: "[Continue assisting the user!]",
	condense: `The user has accepted the condensed conversation summary you generated. This summary covers important details of the historical conversation with the user which has been truncated.\n<explicit_instructions type="condense_response">It's crucial that you respond by ONLY asking the user what you should work on next. You should NOT take any initiative or make any assumptions about continuing with work. For example you should NOT suggest file changes or attempt to read any files.\nWhen asking the user what you should work on next, you can reference information in the summary which was just generated. However, you should NOT reference information outside of what's contained in the summary for this response. Keep this response CONCISE.</explicit_instructions>`,
	fileListTruncated: "(File list truncated. Use list_files on specific subdirectories if you need to explore further.)",
	noFilesFound: "No files found.",

	toolUseInstructionsReminder: `# Reminder: Instructions for Tool Use
Tool uses are formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:
<tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</tool_name>
For example:
<attempt_completion>
<result>
I have completed the task...
</result>
</attempt_completion>
Always adhere to this format for all tool uses to ensure proper parsing and execution.`,

	planModeInstructions: `In this mode you should focus on information gathering, asking questions, and architecting a solution. Once you have a plan, use the plan_mode_respond tool to engage in a conversational back and forth with the user. Do not use the plan_mode_respond tool until you've gathered all the information you need e.g. with read_file or ask_followup_question.
(Remember: If it seems the user wants you to use tools only available in Act Mode, you should ask the user to "toggle to Act mode" (use those words) - they will have to manually do this themselves with the Plan/Act toggle button below. You do not have the ability to switch to Act Mode yourself, and must wait for the user to do it themselves once they are satisfied with the plan. You also cannot present an option to toggle to Act mode, as this will be something you need to direct the user to do manually themselves.)`,

	invalidMcpToolArgumentError:
		"Invalid JSON argument used with @SERVER_NAME@ for @TOOL_NAME@. Please retry with a properly formatted JSON argument.",

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

	executeCommandMissingCommandError: `The 'command' parameter was empty. Provide the shell command to execute.

Example:
<execute_command>
<command>cd /path && python -m pytest tests/</command>
<requires_approval>false</requires_approval>
</execute_command>`,

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

	// Streaming diff parser specific errors
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

	writeToFileBaseError:
		"Failed to write to '@REL_PATH@': The 'content' parameter was empty. This typically happens when the file content is too large to generate in a single response, or when output token limits are reached before the content parameter is fully written.",

	writeToFileContextWarning:
		"Warning: Context window is @CONTEXT_USAGE_PERCENT@% full. The remaining output budget may be insufficient for large file writes. You MUST use a strategy that produces smaller outputs.",

	writeToFileCriticalFail: `CRITICAL: You have failed to write this file @CONSECUTIVE_FAILURES@ times in a row. You MUST change your approach — do NOT retry write_to_file for this file again.

Required action — choose ONE of these strategies:
1. **Create an empty file first, then use replace_in_file** to add content in small sections (recommended)
2. **Break the file into multiple smaller files** if architecturally appropriate
3. **Write a minimal skeleton** using write_to_file (just imports, class/function signatures, no implementations), then use replace_in_file to fill in each section one at a time

Each replace_in_file call should add no more than 50-100 lines of content at a time.`,

	writeToFileSecondFail: `This is your @ATTEMPT_ORDINAL@ failed attempt. The file content is likely too large to generate in one response. You must use a different strategy:

Recommended approaches:
1. **Use write_to_file with a minimal skeleton** (just the structure — imports, class/function signatures, no implementations), then use replace_in_file to fill in each section incrementally
2. **Use replace_in_file with smaller chunks** — if the file already exists, make targeted edits instead of rewriting the entire file
3. **Break the task into smaller steps** — write one function or section at a time

Do NOT attempt to write the full file content in a single write_to_file call again.`,

	writeToFileFirstFail: `Suggestions:
- If the file is large, try breaking down the task into smaller steps. Write a skeleton first, then fill in sections using replace_in_file.
- If the file already exists, prefer replace_in_file to make targeted edits instead of rewriting the entire file.
- Ensure the 'content' parameter contains the complete file content before closing the tool tag.

@TOOL_REMINDER@`,

	taskResumptionPlan:
		"This task was interrupted @AGO_TEXT@. The conversation may have been incomplete. Be aware that the project state may have changed since then. The current working directory is now '@CWD@'.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful. However you are in PLAN MODE, so rather than continuing the task, you must respond to the user's message.",

	taskResumptionAct:
		"This task was interrupted @AGO_TEXT@. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '@CWD@'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.",

	taskResumptionRecentNote:
		"IMPORTANT: If the last tool use was a replace_in_file or write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents.",

	taskResumptionResponsePlanPrefix:
		"New message to respond to with plan_mode_respond tool (be sure to provide your response in the <response> parameter)",

	taskResumptionResponseActPrefix: "New instructions for task continuation",

	taskResumptionNoResponsePlan:
		"(The user did not provide a new message. Consider asking them how they'd like you to proceed, or suggest to them to switch to Act mode to continue with the task.)",

	checkpointRestoreAct:
		"The conversation was restored to a checkpoint. Files may have changed since the checkpoint was created. Continue with the user's edited input below.\n\n<user_message>\n@EDITED_TEXT@\n</user_message>",

	checkpointRestorePlan:
		"The conversation was restored to a checkpoint. Files may have changed since the checkpoint was created. You are in PLAN MODE — respond to the user's edited input below.\n\n<user_message>\n@EDITED_TEXT@\n</user_message>",

	fileEditUserChangesHead: "The user made the following updates to your content:\n\n@USER_EDITS@\n\n",

	fileEditAutoFormattingWithChanges:
		"The user's editor also applied the following auto-formatting to your content:\n\n@AUTO_FORMATTING_EDITS@\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)\n\n",

	fileEditAutoFormattingWithoutChanges:
		"Along with your edits, the user's editor applied the following auto-formatting to your content:\n\n@AUTO_FORMATTING_EDITS@\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)\n\n",

	fileEditUpdatedContent:
		"The updated content has been successfully saved to @REL_PATH@. (wrote @WROTE_LINES@ lines, saved @SAVED_LINES@ lines)\n\n",

	fileEditSuccessContent:
		"The content was successfully saved to @REL_PATH@. (wrote @WROTE_LINES@ lines, saved @SAVED_LINES@ lines)\n",

	replaceEditSuccessContent:
		"The content was successfully replaced in @REL_PATH@. (deleted @DELETED_LINES@ lines, added @ADDED_LINES@ lines, saved @SAVED_LINES@ lines)\n",

	formatterChangedNotice:
		"Note: The file was modified by formatter after saving. Re-read the file before any future replace_in_file operations.\n",

	fileEditNotesWithChanges:
		"Please note:\n1. You do not need to re-write the file with these changes, as they have already been applied.\n2. Proceed with the task using this updated file content as the new baseline.\n3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.\n\n@NEW_PROBLEMS_MESSAGE@",

	fileEditNotesWithoutChanges: "@NEW_PROBLEMS_MESSAGE@",

	fileContextWarning: `<explicit_instructions>
CRITICAL FILE STATE ALERT: @FILE_COUNT@ @FILE_VERB@ been externally modified since your last interaction. Your cached understanding of @FILE_DEMONSTRATIVE_PRONOUN@ is now stale and unreliable. Before making ANY modifications to @FILE_DEMONSTRATIVE_PRONOUN@, you must execute read_file to obtain the current state, as @FILE_PERSONAL_PRONOUN@ may contain completely different content than what you expect:
@FILES_LIST@
Failure to re-read before editing will result in replace_in_file edit errors, requiring subsequent attempts and wasting tokens. You DO NOT need to re-read these files after subsequent edits, unless instructed to do so.
</explicit_instructions>`,

	clineIgnoreInstructions:
		"# .clineignore\n\n(The following is provided by a root-level .clineignore file where the user has specified files and directories that should not be accessed. When using list_files, you'll notice a @LOCK_SYMBOL@ next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n@CONTENT@\n.clineignore",

	clineRulesGlobalDirInstructions:
		"# Global User Rules\n\nThe following is provided by global user rules where the user has specified instructions for all working directories:\n\n@CONTENT@",

	clineRulesLocalDirInstructions:
		"# Local User Rules (.dline/rules/)\n\nThe following is provided by local user rules in @WORKSPACE_NAME@ where the user has specified instructions:\n\n@CONTENT@",

	clineRulesLocalFileInstructions:
		"# Local User Rules (.dline/rules)\n\nThe following is provided by local user rules in @WORKSPACE_NAME@ where the user has specified instructions:\n\n@CONTENT@",

	windsurfRulesLocalFileInstructions:
		"# .windsurfrules\n\nThe following is provided by a root-level .windsurfrules file where the user has specified instructions for this working directory (@CWD@)\n\n@CONTENT@",

	cursorRulesLocalFileInstructions:
		"# .cursorrules\n\nThe following is provided by a root-level .cursorrules file where the user has specified instructions for this working directory (@CWD@)\n\n@CONTENT@",

	cursorRulesLocalDirInstructions:
		"# .cursor/rules\n\nThe following is provided by a root-level .cursor/rules directory where the user has specified instructions for this working directory (@CWD@)\n\n@CONTENT@",

	agentsRulesLocalFileInstructions:
		"# AGENTS.md\n\nThe following is provided by AGENTS.md files found recursively throughout this working directory (@CWD@) where the user has specified instructions. Nested AGENTS.md will be combined below, and you should only apply the instructions for each AGENTS.md file that is directly applicable to the current task, i.e. if you are reading or writing to a file in that directory.\n\n@CONTENT@",
}

export default prompts
