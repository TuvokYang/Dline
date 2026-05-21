// English response prompts — key-value pairs only, no code logic.
// Imported and registered by i18n/index.ts.

const prompts: Record<string, string> = {
	toolDenied: "The user denied this operation.",
	toolError: "The tool execution failed with the following error:\n<error>\n{error}\n</error>",
	clineIgnoreError:
		"Access to {path} is blocked by the .clineignore file settings. You must try to continue in the task without using this file, or ask the user to update the .clineignore file.",
	permissionDeniedError:
		"Command execution blocked by CLINE_COMMAND_PERMISSIONS: {reason}. You must try a different approach or ask the user to update the permission settings.",
	noToolsUsed: `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

{toolReminder}

# Next Steps

If you have completed the user's task, use the attempt_completion tool. 
If you require additional information from the user, use the ask_followup_question tool. 
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. 
(This is an automated message, so do not respond to it conversationally.)`,
	tooManyMistakes:
		"You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n{feedback}\n</feedback>",
	missingToolParameterError:
		"Missing value for required parameter '{paramName}'. Please retry with complete response.\n\n{toolReminder}",
	toolAlreadyUsed:
		"Tool [{toolName}] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.",
	repeatedToolCall:
		"Tool [{toolName}] has been called {count} times consecutively with identical arguments. This is not making progress. Please use a different tool or different arguments instead of repeating the same call.",
	duplicateFileReadNotice:
		"[[NOTE] This file read has been removed to save space in the context window. Refer to the latest file read for the most up to date version of this file.]",
	contextTruncationNotice:
		"[NOTE] Some previous conversation history with the user has been removed to maintain optimal context window length. The initial user task has been retained for continuity, while intermediate conversation history has been removed. Keep this in mind as you continue assisting the user. Pay special attention to the user's latest messages.",
	continueAssisting: "[Continue assisting the user!]",
	condense: `The user has accepted the condensed conversation summary you generated. This summary covers important details of the historical conversation with the user which has been truncated.\n<explicit_instructions type="condense_response">It's crucial that you respond by ONLY asking the user what you should work on next. You should NOT take any initiative or make any assumptions about continuing with work. For example you should NOT suggest file changes or attempt to read any files.\nWhen asking the user what you should work on next, you can reference information in the summary which was just generated. However, you should NOT reference information outside of what's contained in the summary for this response. Keep this response CONCISE.</explicit_instructions>`,
	fileListTruncated: "(File list truncated. Use list_files on specific subdirectories if you need to explore further.)",
}

export default prompts
