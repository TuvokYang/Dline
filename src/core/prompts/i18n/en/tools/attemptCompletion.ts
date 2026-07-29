// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `[TURN-END] After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful. If not, then DO NOT use this tool.`,
	gpt5Description: `[TURN-END] After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful and all tasks have been completed in full. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful and all goals defined by the user have been completed. If not, then DO NOT use this tool.`,
	standardDescription: `[TURN-END] Use this tool only when the user's current task is fully complete. It presents the final result and marks the task completed; it is not a progress update, partial result, plan, report, question, or ordinary conversation.

Before calling it, finish and verify all requested work. If task_progress tracking is active, every checklist item must already be marked [x]. Summarize what was completed and the verification outcome. Optionally provide an actionable CLI command that lets the user review the result.`,
	focusOmissionChecklistSentence: " If task_progress tracking is active, every checklist item must already be marked [x].",
	resultInstruction: "The result of the tool use. This should be a clear, specific description of the result.",
	resultUsage: "Your final result description here",
	standardResultInstruction:
		"A clear, specific, brief one- or two-paragraph summary of the final result, including what was completed and the relevant verification outcome.",
	commandInstruction:
		"A CLI command to execute to show a live demo of the result to the user. For example, use `open index.html` to display a created html website, or `open localhost:3000` to display a locally running development server. But DO NOT use commands like `echo` or `cat` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions",
	commandUsage: "Your command here (optional)",
	standardCommandInstruction:
		"An actionable terminal command that is non-verbose that allows user to review the result of your work. For example, use `start localhost:3000` to start a locally running development server. Commands like `echo` or `cat` that merely print text or open a file are not allowed. Ensure the command is properly formatted for user's OS and does not contain any harmful instructions",
	taskProgressInstruction:
		"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
	taskProgressUsage: "Checklist here (required if you used task_progress in previous tool uses)",
	taskProgressDescription:
		"If you were using task_progress to update the task progress, you must include the completed list in the result as well.",
	standardTaskProgressInstruction:
		"A checklist showing task progress with the latest status of each subtasks included previously, if any. If you are calling attempt completion, and all items in this list have been completed, they must be marked as completed in this response.",
}
export default prompts
