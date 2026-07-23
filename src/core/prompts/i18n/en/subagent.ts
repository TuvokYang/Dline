// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Run up to five built-in default subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this for broad exploration when reading many files would consume the main agent's context window. Using one subagent is valid.",
	singleDescription:
		"Run one focused default or named subagent. Omit agent_name or use 'default' for the built-in readonly research subagent; use an advertised YAML name for a configured agent.",
	agentNameInstruction: "Optional advertised subagent name. Omit or use 'default' for the built-in default profile.",
	taskInstruction: "Focused task for the subagent.",
	contextInstruction: "Relevant context, constraints, and expected result for the subagent.",
	prompt1Instruction: "First subagent prompt.",
	prompt2Instruction: "Optional second subagent prompt.",
	prompt3Instruction: "Optional third subagent prompt.",
	prompt4Instruction: "Optional fourth subagent prompt.",
	prompt5Instruction: "Optional fifth subagent prompt.",
}
export default prompts
