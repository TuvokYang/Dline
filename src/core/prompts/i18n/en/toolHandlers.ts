// English tool handler error/prompt messages — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	// AttemptCompletionHandler
	doubleCheckVerification:
		"Before completing, re-verify your work against the original task requirements. Check that:\n" +
		"1. All requested changes have been made\n" +
		"2. No steps were skipped or partially completed\n" +
		"3. Edge cases and error handling are addressed\n" +
		"4. The solution matches what was asked for, not just what was convenient\n" +
		"5. Output files contain exactly what was specified--no extra columns, fields, debug output, or commentary\n" +
		"6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion" +
		"{taskSection}" +
		"\n\nIf everything checks out, call attempt_completion again with your final result.",

	attemptCompletionNotificationSubtitle: "Task Completed",

	// AskFollowupQuestionToolHandler
	yoloAutoRespond: '[YOLO MODE] Auto-responding to question: "{question}"',
	yoloToolResult:
		'[YOLO MODE: User input is not available in non-interactive mode. You must use available tools (read_file, list_files, search_files, etc.) to gather the information you need instead of asking the user. Proceed with using tools to find the answer to your question: "{question}"]',
	askFollowupNotificationSubtitle: "Dline has a question...",

	// CondenseHandler
	condenseMissingContext: "Missing required parameter: context",
	condenseNotificationSubtitle: "Dline wants to condense the conversation...",
	condenseNotificationMessage: "Dline is suggesting to condense your conversation with: {context}",
	condenseFeedbackResult: "The user provided feedback on the condensed conversation summary:\n<feedback>\n{text}\n</feedback>",

	// PlanModeRespondHandler
	planNeedsMoreExploration:
		"[You have indicated that you need more exploration. Proceed with calling tools to continue the planning process.]",
	planYoloAutoExecute: "[Go ahead and execute.]",
	planYoloSwitchToAct: "[The user has switched to ACT MODE, so you may now proceed with the task.]",
	planYoloSwitchFailed: "YOLO MODE: Failed to switch to ACT MODE, continuing with normal plan mode",

	// GenerateExplanationToolHandler
	generateExplanationApiNotAvailable: "API configuration not available",
	generateExplanationNoChanges: "No changes found between '{fromRef}' and '{toRef}'.",
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
		"[The user has switched to ACT MODE, so you may now proceed with the task.]\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n{text}\n</user_message>",

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
