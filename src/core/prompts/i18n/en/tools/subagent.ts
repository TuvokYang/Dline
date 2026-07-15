// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Run up to five focused in-process subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this for broad exploration when reading many files would consume the main agent's context window. You do not need to launch multiple subagents every time; using one subagent is valid when it avoids unnecessary context usage for light discovery work.",
	prompt1Instruction: "First subagent prompt. Must include <task> and <context> sections.",
	prompt2Instruction: "Optional second subagent prompt. Must include <task> and <context> sections when provided.",
	prompt3Instruction: "Optional third subagent prompt. Must include <task> and <context> sections when provided.",
	prompt4Instruction: "Optional fourth subagent prompt. Must include <task> and <context> sections when provided.",
	prompt5Instruction: "Optional fifth subagent prompt. Must include <task> and <context> sections when provided.",
	backgroundInstruction: "Optional boolean. Set true to run the batch in background. Defaults to false.",
	timeoutInstruction: "Optional positive integer timeout in seconds for each subagent. Defaults to 600.",
}
export default prompts
