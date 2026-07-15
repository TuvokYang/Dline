// English tool handler error/prompt messages — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	toolDenied: "The user denied this operation.",
	toolError: "The tool execution failed with the following error:\n<error>\n@ERROR@\n</error>",
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

	// AttemptCompletionHandler
	doubleCheckVerification:
		"Before completing, re-verify your work against the original task requirements. Check that:\n" +
		"1. All requested changes have been made\n" +
		"2. No steps were skipped or partially completed\n" +
		"3. Edge cases and error handling are addressed\n" +
		"4. The solution matches what was asked for, not just what was convenient\n" +
		"5. Output files contain exactly what was specified--no extra columns, fields, debug output, or commentary\n" +
		"6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion" +
		"@TASK_SECTION@" +
		"\n\nIf everything checks out, call attempt_completion again with your final result.",

	attemptCompletionNotificationSubtitle: "Task Completed",

	// AskFollowupQuestionToolHandler
	yoloAutoRespond: '[YOLO MODE] Auto-responding to question: "@QUESTION@"',
	yoloToolResult:
		'[YOLO MODE: User input is not available in non-interactive mode. You must use available tools (read_file, list_files, search_files, etc.) to gather the information you need instead of asking the user. Proceed with using tools to find the answer to your question: "@QUESTION@"]',
	askFollowupNotificationSubtitle: "Dline has a question...",

	// CondenseHandler
	condenseMissingContext: "Missing required parameter: context",
	condenseNotificationSubtitle: "Dline wants to condense the conversation...",
	condenseNotificationMessage: "Dline is suggesting to condense your conversation with: @CONTEXT@",
	condenseFeedbackResult: "The user provided feedback on the condensed conversation summary:\n<feedback>\n@TEXT@\n</feedback>",

	// PlanModeRespondHandler
	planNeedsMoreExploration:
		"[You have indicated that you need more exploration. Proceed with calling tools to continue the planning process.]",
	planYoloAutoExecute: "[Go ahead and execute.]",
	planYoloSwitchToAct: "[The user has switched to ACT MODE, so you may now proceed with the task.]",
	planYoloSwitchFailed: "YOLO MODE: Failed to switch to ACT MODE, continuing with normal plan mode",

	// GenerateExplanationToolHandler
	generateExplanationApiNotAvailable: "API configuration not available",
	generateExplanationNoChanges: "No changes found between '@FROM_REF@' and '@TO_REF@'.",
	generateExplanationCancelled: "Explanation generation was cancelled.",

	// SubagentToolHandler
	subagentsDisabled: "Subagents are disabled. Enable them in Settings > Features to use this tool.",

	// WebFetchToolHandler
	webToolsDisabled: "Dline web tools are currently disabled.",

	// WebSearchToolHandler
	webSearchDisabled: "Dline web tools are currently disabled.",
	webSearchDomainConflict: "Cannot specify both allowed_domains and blocked_domains",

	// PlanModeRespondHandler (non-yolo mode switch)
	planSwitchToAct: "[The user has switched to ACT MODE, so you may now proceed with the task.]",
	planSwitchToActWithMessage:
		"[The user has switched to ACT MODE, so you may now proceed with the task.]\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n@TEXT@\n</user_message>",

	// ApplyPatchHandler
	patchDenied: "The user denied this patch operation.",
	patchSuccess: "Successfully applied patch to the following files:",
	patchInvalidSentinels: "Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.",

	// SpawnTaskHandler
	spawnTaskFailed:
		"Spawn task failed: unable to access extension context from parent task. The parent task must have an active controller context.",

	// SearchFilesToolHandler
	searchNoResults: "Found 0 results.",

	// SummarizeTaskHandler
	contextCompactionCancelled: "Context compaction was cancelled. Task has been aborted.",

	// NewTaskHandler
	newTaskCreated: "The user has created a new task with the provided context.",

	// SubagentToolHandler
	subagentExecutionFailed: "Subagent execution failed",

	// WriteToFileToolHandler
	writeToFileRetrying: "Retrying...",
	writeToFileApproachChange: "This has happened multiple times — Dline will try a different approach.",
	writeToFileNotUpdated: "The file was not updated, and maintains its original contents.",
	writeToFileNotCreated: "The file was not created.",
}

export default prompts
