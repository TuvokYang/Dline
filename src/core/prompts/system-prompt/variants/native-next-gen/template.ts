import { getPrompt } from "../../../i18n"
import { hasEnabledMcpServers } from "../../components/mcp"
import { SystemPromptSection } from "../../templates/placeholders"
import type { SystemPromptContext } from "../../types"

/**
 * Base template for GPT-5 variant with structured sections
 */
export const BASE = `{{${SystemPromptSection.AGENT_ROLE}}}

{{${SystemPromptSection.TOOL_USE}}}

====

{{${SystemPromptSection.TODO}}}

====

{{${SystemPromptSection.TASK_PROGRESS}}}

====

{{${SystemPromptSection.EDITING_FILES}}}

====

{{${SystemPromptSection.ACT_VS_PLAN}}}

====

{{${SystemPromptSection.CAPABILITIES}}}

====

{{${SystemPromptSection.SKILLS}}}

====

{{${SystemPromptSection.FEEDBACK}}}

====

{{${SystemPromptSection.RULES}}}

====

{{${SystemPromptSection.SYSTEM_INFO}}}

====

{{${SystemPromptSection.OBJECTIVE}}}

====

{{${SystemPromptSection.USER_INSTRUCTIONS}}}`

const RULES = (context: SystemPromptContext) => {
	const hasMcpServers = hasEnabledMcpServers(context)

	return `RULES

- The current working directory is \`{{CWD}}\` - this is the directory where all the tools will be executed from.${
		context.enableParallelToolCalling
			? `
- You may use multiple tools in a single response when the operations are independent (e.g., reading several files, creating independent files). For dependent operations where one result informs the next, use tools sequentially and wait for the user's response.`
			: ""
	}{{BROWSER_WAIT_RULES}}${hasMcpServers ? "\n- MCP operations should be used one at a time, similar to other tool usage. Wait for confirmation of success before proceeding with additional operations." : ""}
- Answer user questions directly when asked. Avoid unnecessary conversational filler, but always respond to explicit questions before continuing work.
- EVERY response must include at least one tool call. Pure text without a tool call will be rejected.
- TURN-END TOOLS (attempt_completion, ask_followup_question, plan_mode_respond, qna_respond, generate_report): FORBIDDEN while any focus chain items remain [ ]. Each tool's description defines its strict usage conditions. Read them before calling.
  * attempt_completion: ONLY when ALL focus chain items marked [x] AND verified.
  * ask_followup_question: ONLY when blocked with no tool can help, after >=2 failed approaches.
  * status_update / act_mode_respond: progress-only, MUST be followed by actual work tool. NOT for completion.
- FOCUS CHAIN: Follow it exactly. Never fabricate plans without real project knowledge. Never skip, reorder, or modify items — ONLY toggle [ ] <-> [x]. To change structure, use focus_chain_change (user approval required). Complete items in order.
- USER'S CUSTOM INSTRUCTIONS below (global rules and project rules) define additional binding constraints — project operation rules, coding style, and tool execution policies. These user rules carry the same weight as the system rules above. Check both before any state-modifying action.
`
}

const TOOL_USE = (context: SystemPromptContext) => `TOOL USE

You have access to a set of tools that are executed upon the user's approval.${context.enableParallelToolCalling ? " You may use multiple tools in a single response when the operations are independent (e.g., reading several files, searching in parallel). For dependent operations where one result informs the next, use tools sequentially." : ""} You will receive the results of all tool uses in the user's response.

NEVER use command-line tools (sed, awk, ripgrep) or scripting languages (python, node, bash scripts) to read or edit files. The existing file editing tools are sufficient for all file operations. If you cannot accomplish a file operation through the provided tool calling mechanism, stop and explain that your approach is incompatible with Dline's tool-based workflow.

## TURN-END Tools
Some tools are marked [TURN-END] in their description. These tools end the current execution turn — after calling one, you MUST wait for the user to respond before continuing. All other tools return results immediately and you proceed automatically to the next step.

## Explicit Instructions
When you see \`<explicit_instructions type="tool_name">\` in the conversation, call the <tool_name> tool using the example XML format provided inside the instructions. Do NOT look for this tool in the standard tool list. Output the XML directly as defined, without wrapping it inside attempt_completion or any other tool.

EVERY response must include at least one tool call, except explicit_instructions. When actively working, use work tools step by step. TURN-END tools are FORBIDDEN while focus chain items remain [ ] — see each tool's description for strict usage conditions:
- attempt_completion: ALL items [x] + verified
- ask_followup_question: blocked after >=2 failed attempts
- plan_mode_respond: PLAN MODE only
- qna_respond / generate_report: direct question / report request only
- status_update / act_mode_respond: progress-only, then real work`

const ACT_VS_PLAN = (context: SystemPromptContext) =>
	getPrompt("nativeNextGenActVsPlan", "main", {
		clarifyPermission:
			context.yoloModeToggled !== true
				? " You may also ask the user clarifying questions with ask_followup_question to get a better understanding of the task."
				: "",
	})

const OBJECTIVE = (context: SystemPromptContext) =>
	getPrompt("nativeNextGenObjective", "main", {
		parallelToolPolicy: context.enableParallelToolCalling
			? "You may call multiple independent tools in one response when it improves progress without coupling dependent steps."
			: "Use one tool at a time and let each result inform the next step.",
		clarifyRule:
			context.yoloModeToggled === true
				? "state safe, reversible assumptions clearly and continue only when risk is low"
				: "ask a focused clarifying question rather than making risky assumptions",
	})

const FEEDBACK = (_context: SystemPromptContext) => `FEEDBACK

When user is providing you with feedback on how you could improve, you can let the user know to report new issue using the '/reportbug' slash command.`

export const TEMPLATE_OVERRIDES = {
	BASE,
	RULES,
	TOOL_USE,
	OBJECTIVE,
	FEEDBACK,
	ACT_VS_PLAN,
} as const
