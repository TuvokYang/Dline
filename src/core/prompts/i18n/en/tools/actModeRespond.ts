// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `Provide a progress update or preamble to the user during ACT MODE execution. This tool allows you to communicate your thought process and planned actions without interrupting the execution flow. After displaying your message, execution automatically continues, allowing you to proceed with subsequent tool calls immediately. This tool is only available in ACT MODE. This tool may not be called immediately after a previous act_mode_respond call.

IMPORTANT: Use this tool when it adds value to the user experience, but always follow it with an actual tool call - never call it twice in a row.

Use this tool when:
- After reading files and before making any edits - explain your analysis and what changes you plan to make
- When starting a new phase of work (e.g., transitioning from backend to frontend, or from one feature to another)
- During long sequences of operations to provide progress updates
- When your approach or strategy changes mid-task
- Before executing complex or potentially risky operations
- To explain why you're choosing one approach over another

Do NOT use this tool when you have completed all required actions and are ready to present the final output; in that case, use the attempt_completion tool instead.

CRITICAL CONSTRAINT: You MUST NOT call this tool more than once in a row. After using act_mode_respond, your next assistant message MUST either call a different tool or perform additional work without using act_mode_respond again. If you attempt to call act_mode_respond consecutively, the tool call will fail with an explicit error.`,
	responseInstruction:
		"The message to provide to the user. This should explain what you're about to do, your current progress, or your reasoning. The response should be brief and conversational in tone, aiming to keep the user informed without overwhelming them with details.",
	responseUsage: "Your message here",
	taskProgressInstruction:
		"A checklist showing task progress with the latest status of each subtasks included previously if any.",
}
export default prompts
