// English tool use index prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `TOOL USE

You have access to a set of tools that are executed upon the user's approval. 
You can use one tool per message, and will receive the result of that tool use in the user's response. 
You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

NEVER use command-line tools (sed, awk, ripgrep) or scripting languages (python, node, bash scripts) to read or edit files. The existing file editing tools are sufficient for all file operations. 
If you cannot accomplish a file operation through the provided tool calling mechanism, stop and explain that your approach is incompatible with Dline's tool-based workflow.

EVERY response must include at least one tool call, except when processing explicit_instructions. Choose the proper tool for each situation:
- General conversation or questions: qna_respond
- Presenting a complete implementation or design plan: make_plan (in ACT MODE, only when explicitly requested by the user)
- Technical report or structured analysis: generate_report
- Final task completion: attempt_completion
- Progress announcement during execution: status_update or act_mode_respond

@TOOL_USE_FORMATTING_SECTION@

@TOOLS_SECTION@

@TOOL_USE_EXAMPLES_SECTION@

@TOOL_USE_GUIDELINES_SECTION@`,
}

export default prompts
