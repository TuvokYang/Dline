import { ClineDefaultTool } from "../../../shared/tools"
import { getPrompt } from "../i18n"
import type { SystemPromptContext } from "../system-prompt/context"
import type { ProfileToolParam, ProfileToolSpec } from "./profile-tool-set"

const taskProgress: ProfileToolParam = {
	name: "task_progress",
	required: false,
	instruction: getPrompt("taskProgress", "paramInstruction"),
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

/** Creates one immutable tool parameter descriptor. */
function param(
	name: string,
	required: boolean,
	instruction: string,
	type: ProfileToolParam["type"] = "string",
): ProfileToolParam {
	return { name, required, instruction, type }
}

/** Reports whether at least one connected enabled MCP server is available. */
function hasMcp(context: SystemPromptContext): boolean {
	return context.mcpHub?.getServers()?.some((server) => server.status === "connected" && server.disabled !== true) ?? false
}

/** Reports whether browser tools are enabled for this runtime. */
function hasBrowser(context: SystemPromptContext): boolean {
	return context.supportsBrowserUse === true && context.browserSettings?.disableToolUse !== true
}

/** Reports whether a tool may be exposed in an interactive environment. */
function isInteractive(context: SystemPromptContext): boolean {
	return context.yoloModeToggled !== true
}

/** Reports whether Cline-hosted web tools are enabled. */
function hasWebTools(context: SystemPromptContext): boolean {
	return context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true
}

/** Reports whether configured skills are available. */
function hasSkills(context: SystemPromptContext): boolean {
	return (context.skills?.length ?? 0) > 0
}

/** Reports whether subagents may be invoked from the current task. */
function hasSubagents(context: SystemPromptContext): boolean {
	return context.subagentsEnabled === true && context.isSubagentRun !== true
}

/** Creates the canonical Native descriptor for one built-in tool. */
function spec(
	id: ClineDefaultTool,
	description: string,
	parameters: readonly ProfileToolParam[] = [],
	contextRequirements?: (context: SystemPromptContext) => boolean,
): Omit<ProfileToolSpec, "profile"> {
	return { transport: "both", id, name: id, description, parameters, contextRequirements }
}

const LOAD_PARAMS = [param("name", true, getPrompt("loadCapability", "nameInstruction"))]
const SINGLE_SUBAGENT_PARAMS = [
	param("agent_name", false, getPrompt("subagent", "agentNameInstruction")),
	param("task", true, getPrompt("subagent", "taskInstruction")),
	param("context", true, getPrompt("subagent", "contextInstruction")),
	param("background", false, getPrompt("subagent", "backgroundInstruction"), "boolean"),
	param("timeout", false, getPrompt("subagent", "timeoutInstruction"), "integer"),
]
const SUBAGENT_PARAMS = [
	param("prompt_1", true, getPrompt("subagent", "prompt1Instruction")),
	param("prompt_2", false, getPrompt("subagent", "prompt2Instruction")),
	param("prompt_3", false, getPrompt("subagent", "prompt3Instruction")),
	param("prompt_4", false, getPrompt("subagent", "prompt4Instruction")),
	param("prompt_5", false, getPrompt("subagent", "prompt5Instruction")),
	param("background", false, getPrompt("subagent", "backgroundInstruction"), "boolean"),
	param("timeout", false, getPrompt("subagent", "timeoutInstruction"), "integer"),
]

export const NATIVE_TOOL_SPECS: readonly Omit<ProfileToolSpec, "profile">[] = [
	spec(ClineDefaultTool.FILE_NEW, getPrompt("writeToFile", "nativeDescription"), [
		param("absolutePath", true, getPrompt("writeToFile", "nativePathInstruction")),
		param("content", true, getPrompt("writeToFile", "nativeContentInstruction")),
		taskProgress,
	]),
	spec(ClineDefaultTool.FILE_EDIT, getPrompt("replaceInFile", "nativeDescription"), [
		param("absolutePath", true, getPrompt("replaceInFile", "nativePathInstruction")),
		param("diff", true, getPrompt("replaceInFile", "baseDiffInstructions")),
		taskProgress,
	]),
	spec(ClineDefaultTool.FILE_READ, getPrompt("readFile", "description"), [
		param("path", true, getPrompt("readFile", "pathInstruction")),
		param("start_line", false, getPrompt("readFile", "startLineInstruction"), "integer"),
		param("end_line", false, getPrompt("readFile", "endLineInstruction"), "integer"),
		taskProgress,
	]),
	spec(ClineDefaultTool.SEARCH, getPrompt("searchFiles", "description"), [
		param("path", true, getPrompt("searchFiles", "pathInstruction")),
		param("regex", true, getPrompt("searchFiles", "regexInstruction")),
		param("file_pattern", false, getPrompt("searchFiles", "filePatternInstruction")),
		taskProgress,
	]),
	spec(ClineDefaultTool.LIST_FILES, getPrompt("listFiles", "description"), [
		param("path", true, getPrompt("listFiles", "nativePathInstruction")),
		param("recursive", false, getPrompt("listFiles", "recursiveInstruction"), "boolean"),
		param("show_metadata", false, getPrompt("listFiles", "showMetadataInstruction"), "boolean"),
		taskProgress,
	]),
	spec(ClineDefaultTool.LIST_CODE_DEF, getPrompt("listCodeDefinitionNames", "description"), [
		param("path", true, getPrompt("listCodeDefinitionNames", "pathInstruction")),
		taskProgress,
	]),
	spec(
		ClineDefaultTool.ASK,
		getPrompt("askFollowupQuestion", "nativeDescription"),
		[
			param("question", true, getPrompt("askFollowupQuestion", "nativeQuestionInstruction")),
			param("options", true, getPrompt("askFollowupQuestion", "nativeOptionsInstruction")),
			taskProgress,
		],
		isInteractive,
	),
	spec(ClineDefaultTool.ATTEMPT, getPrompt("attemptCompletion", "nativeDescription"), [
		param("result", true, getPrompt("attemptCompletion", "nativeResultInstruction")),
		param("command", false, getPrompt("attemptCompletion", "nativeCommandInstruction")),
	]),
	spec(ClineDefaultTool.PLAN_MODE, getPrompt("planModeRespond", "description"), [
		param("response", true, getPrompt("planModeRespond", "nativeResponseInstruction")),
		taskProgress,
	]),
	spec(ClineDefaultTool.QNA_RESPOND, getPrompt("qnaRespond", "nativeDescription"), [
		param("response", true, getPrompt("qnaRespond", "nativeResponseInstruction")),
	]),
	spec(ClineDefaultTool.ACT_MODE, getPrompt("actModeRespond", "description"), [
		param("response", true, getPrompt("actModeRespond", "responseInstruction")),
	]),
	spec(ClineDefaultTool.BASH, getPrompt("executeCommand", "nativeDescription"), [
		param("command", true, getPrompt("executeCommand", "nativeCommandInstruction")),
		param("requires_approval", true, getPrompt("executeCommand", "nativeRequiresApprovalInstruction"), "boolean"),
		param("background", false, getPrompt("executeCommand", "nativeBackgroundInstruction"), "boolean"),
		param("timeout", false, getPrompt("executeCommand", "nativeTimeoutInstruction"), "integer"),
	]),
	spec(
		ClineDefaultTool.BROWSER,
		getPrompt("browserAction", "description"),
		[
			param("action", true, getPrompt("browserAction", "nativeActionInstruction")),
			param("url", false, getPrompt("browserAction", "nativeUrlInstruction")),
			param("coordinate", false, getPrompt("browserAction", "nativeCoordinateInstruction")),
			param("text", false, getPrompt("browserAction", "nativeTextInstruction")),
		],
		hasBrowser,
	),
	spec(
		ClineDefaultTool.WEB_FETCH,
		getPrompt("webFetch", "nativeDescription"),
		[
			param("url", true, getPrompt("webFetch", "urlInstruction")),
			param("prompt", true, getPrompt("webFetch", "nativePromptInstruction")),
			taskProgress,
		],
		hasWebTools,
	),
	spec(
		ClineDefaultTool.WEB_SEARCH,
		getPrompt("webSearch", "nativeDescription"),
		[
			param("query", true, getPrompt("webSearch", "queryInstruction")),
			param("allowed_domains", false, getPrompt("webSearch", "allowedDomainsInstruction")),
			param("blocked_domains", false, getPrompt("webSearch", "blockedDomainsInstruction")),
			taskProgress,
		],
		hasWebTools,
	),
	spec(
		ClineDefaultTool.MCP_USE,
		getPrompt("useMcpTool", "description"),
		[
			param("server_name", true, getPrompt("useMcpTool", "serverNameInstruction")),
			param("tool_name", true, getPrompt("useMcpTool", "toolNameInstruction")),
			param("arguments", true, getPrompt("useMcpTool", "argumentsInstruction")),
			taskProgress,
		],
		hasMcp,
	),
	spec(
		ClineDefaultTool.MCP_ACCESS,
		getPrompt("accessMcpResource", "nativeDescription"),
		[
			param("server_name", true, getPrompt("accessMcpResource", "serverNameInstruction")),
			param("uri", true, getPrompt("accessMcpResource", "uriInstruction")),
			taskProgress,
		],
		hasMcp,
	),
	spec(ClineDefaultTool.MCP_DOCS, getPrompt("loadMcpDocumentationTool", "description"), [], hasMcp),
	spec(
		ClineDefaultTool.USE_SKILL,
		getPrompt("useSkill", "description"),
		[param("skill_name", true, getPrompt("useSkill", "skillNameInstruction"))],
		hasSkills,
	),
	spec(ClineDefaultTool.LOAD_MCP, getPrompt("loadCapability", "nativeDescription"), LOAD_PARAMS, hasMcp),
	spec(ClineDefaultTool.LOAD_SKILL, getPrompt("loadCapability", "nativeDescription"), LOAD_PARAMS),
	spec(ClineDefaultTool.LOAD_WORKFLOW, getPrompt("loadCapability", "nativeDescription"), LOAD_PARAMS),
	spec(ClineDefaultTool.FIND_REFERENCES, getPrompt("findReferences", "nativeDescription"), [
		param("file_path", true, getPrompt("findReferences", "filePathInstruction")),
		param("line", true, getPrompt("findReferences", "lineInstruction"), "integer"),
		param("character", true, getPrompt("findReferences", "characterInstruction"), "integer"),
		taskProgress,
	]),
	spec(ClineDefaultTool.RENAME, getPrompt("rename", "nativeDescription"), [
		param("file_path", true, getPrompt("rename", "filePathInstruction")),
		param("line", true, getPrompt("rename", "lineInstruction"), "integer"),
		param("character", true, getPrompt("rename", "characterInstruction"), "integer"),
		param("new_name", true, getPrompt("rename", "newNameInstruction")),
		param("dry_run", false, getPrompt("rename", "dryRunInstruction"), "boolean"),
		taskProgress,
	]),
	spec(ClineDefaultTool.REPLACE_TEXT, getPrompt("replaceText", "nativeDescription"), [
		param("find", true, getPrompt("replaceText", "findInstruction")),
		param("replace", true, getPrompt("replaceText", "replaceInstruction")),
		param("file_pattern", true, getPrompt("replaceText", "filePatternInstruction")),
		param("dry_run", false, getPrompt("replaceText", "dryRunInstruction"), "boolean"),
		param("literal", false, getPrompt("replaceText", "literalInstruction"), "boolean"),
		taskProgress,
	]),
	spec(ClineDefaultTool.APPLY_PATCH, getPrompt("applyPatch", "description"), [
		param("input", true, getPrompt("applyPatch", "inputInstruction")),
		taskProgress,
	]),
	spec(ClineDefaultTool.SPAWN_TASK, getPrompt("spawnTask", "description"), [
		param("task", true, getPrompt("spawnTask", "taskInstruction")),
		param("context", false, getPrompt("spawnTask", "contextInstruction")),
	]),
	spec(
		ClineDefaultTool.FOCUS_CHAIN_CHANGE,
		getPrompt("focusChain", "focusChainChangeToolDescription"),
		[
			param("new_plan", true, getPrompt("focusChain", "focusChainChangeNewPlanNativeInstruction")),
			param("reason", false, getPrompt("focusChain", "focusChainChangeReasonNativeInstruction")),
		],
		(context) => context.focusChainSettings?.enabled === true,
	),
	spec(ClineDefaultTool.USE_SUBAGENT, getPrompt("subagent", "singleDescription"), SINGLE_SUBAGENT_PARAMS, hasSubagents),
	spec(ClineDefaultTool.USE_SUBAGENTS, getPrompt("subagent", "description"), SUBAGENT_PARAMS, hasSubagents),
	spec(ClineDefaultTool.STATUS_UPDATE, getPrompt("statusUpdate", "nativeDescription"), [
		param("response", true, getPrompt("statusUpdate", "responseInstruction")),
		param("requires_acknowledgment", false, getPrompt("statusUpdate", "requiresAcknowledgmentInstruction"), "boolean"),
		taskProgress,
	]),
	spec(
		ClineDefaultTool.GENERATE_EXPLANATION,
		getPrompt("generateExplanation", "description"),
		[
			param("title", true, getPrompt("generateExplanation", "titleInstruction")),
			param("from_ref", true, getPrompt("generateExplanation", "fromRefInstruction")),
			param("to_ref", false, getPrompt("generateExplanation", "toRefInstruction")),
		],
		(context) => context.isCliEnvironment !== true,
	),
	spec(ClineDefaultTool.GENERATE_REPORT, getPrompt("generateReport", "nativeDescription"), [
		param("title", true, getPrompt("generateReport", "titleInstruction")),
		param("content", true, getPrompt("generateReport", "contentInstruction")),
		taskProgress,
	]),
]
