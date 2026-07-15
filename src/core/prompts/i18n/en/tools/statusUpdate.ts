// English prompts for status_update tool — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `Provide a progress statement or announcement to the user during task execution. By default, execution continues immediately — you can proceed with the next tool call without waiting. Use this tool for phase transitions, milestone announcements, or when you want to inform the user of your current approach.

Set requires_acknowledgment to true ONLY when you explicitly need the user to confirm before continuing — this displays "知晓" (acknowledge) and "停止" (stop) buttons. The user can stop the task or acknowledge and let you continue.

IMPORTANT: Do NOT use this tool consecutively. After calling status_update, your next tool call must be a different tool performing actual work. This tool is NOT for final completion — use attempt_completion for that. Do NOT use status_update merely to update task_progress — task_progress updates are silent and should be done via the task_progress parameter on any tool call. Use status_update only for meaningful announcements that the user needs to read.`,

	nativeDescription: `Provide a progress statement or announcement to the user during task execution. By default, execution continues immediately — you can proceed with the next tool call without waiting. Use this tool for phase transitions, milestone announcements, or when you want to inform the user of your current approach.

Set requires_acknowledgment to true ONLY when you explicitly need the user to confirm before continuing — this displays "知晓" (acknowledge) and "停止" (stop) buttons. The user can stop the task or acknowledge and let you continue.

IMPORTANT: Do NOT use this tool consecutively. After calling status_update, your next tool call must be a different tool performing actual work. This tool is NOT for final completion — use attempt_completion for that. Do NOT use status_update merely to update task_progress — task_progress updates are silent and should be done via the task_progress parameter on any tool call. Use status_update only for meaningful announcements that the user needs to read.`,

	responseInstruction: `The progress statement or announcement text. Be concise and informative.`,

	responseUsage: "Your announcement text here",

	requiresAcknowledgmentInstruction: `Set to true if you need the user to explicitly acknowledge before continuing. Defaults to false — execution continues immediately.`,

	requiresAcknowledgmentUsage: "true or false (defaults to false)",

	taskProgressInstruction: `Optionally update the task progress checklist.`,
}
export default prompts
