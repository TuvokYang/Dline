// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Run up to five focused in-process subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this for broad exploration when reading many files would consume the main agent's context window. You do not need to launch multiple subagents every time; using one subagent is valid when it avoids unnecessary context usage for light discovery work.",
	prompt1Instruction: "First subagent prompt.",
	prompt2Instruction: "Optional second subagent prompt.",
	prompt3Instruction: "Optional third subagent prompt.",
	prompt4Instruction: "Optional fourth subagent prompt.",
	prompt5Instruction: "Optional fifth subagent prompt.",
}
export default prompts
