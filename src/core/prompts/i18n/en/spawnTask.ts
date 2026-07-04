// English prompts for spawn_task tool — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `Spawn a new independent task. The spawned task has its OWN context — it does NOT inherit the parent's conversation history. Use the task parameter for goals and the context parameter for background information. The task runs autonomously in PLAN mode with auto-run enabled, inheriting the parent's API provider, MCP servers, and rules. The user must approve before creation.`,
	taskInstruction: `Describe what the spawned task should investigate or execute. Be specific about the goals and expected work to be done.`,
	taskUsage: "Task description here",
	contextInstruction: `Provide relevant background context for the spawned task. Include: why this task is needed, relevant conversation history or prior work, key technical concepts, constraints, and configuration. The spawned task cannot access the parent's conversation history — include everything it needs to know.`,
	contextUsage: "additional context (optional)",
}
export default prompts
