// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Run up to five built-in default subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this to preserve the main task's context window by delegating self-contained research. Keep each delegated research boundary independent from the main task's modification boundary: provide only the context needed for investigation, and do not treat files explored or reported by a subagent as authorized write scope. Using one subagent is valid.",
	singleDescription:
		"Run one focused default or named subagent. Omit agent_name or use 'default' for the built-in readonly research subagent; use an advertised YAML name for a configured agent. Use this to preserve the main task's context window through self-contained research. Keep the delegated research boundary independent from the main task's modification boundary, and do not infer write authorization from files the subagent explores or reports.",
	agentNameInstruction: "Optional advertised subagent name. Omit or use 'default' for the built-in default profile.",
	taskInstruction: "Focused task for the subagent.",
	contextInstruction:
		"Relevant context, constraints, and expected result for the subagent. Include enough context for independent research, but do not use this field to expand or redefine the main task's modification boundary.",
	prompt1Instruction: "First subagent prompt. Must include <task> and <context> sections.",
	prompt2Instruction: "Optional second subagent prompt. Must include <task> and <context> sections when provided.",
	prompt3Instruction: "Optional third subagent prompt. Must include <task> and <context> sections when provided.",
	prompt4Instruction: "Optional fourth subagent prompt. Must include <task> and <context> sections when provided.",
	prompt5Instruction: "Optional fifth subagent prompt. Must include <task> and <context> sections when provided.",
	backgroundInstruction: "Optional boolean. Set true to run in background. Defaults to false.",
	timeoutInstruction: "Optional positive integer timeout in seconds for each subagent. Defaults to @SUBAGENT_TIMEOUT_SECONDS@.",
}
export default prompts
