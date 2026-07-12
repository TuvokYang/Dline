import type {
	InputPolicy,
	InteractionActionDefinition,
	InteractionActionType,
	InteractionDefinition,
	InteractionKind,
	PayloadPolicy,
} from "./Interaction"

export const INTERACTION_KINDS = [
	"tool_approval",
	"command_approval",
	"browser_approval",
	"mcp_approval",
	"subagent_approval",
	"spawn_task_approval",
	"focus_chain_change",
	"new_task",
	"report_bug",
	"condense",
	"followup",
	"plan_response",
	"qna_response",
	"generate_report",
	"status_acknowledgment",
	"error_retry",
	"mistake_limit",
	"completion",
	"resume",
] as const satisfies readonly InteractionKind[]

const DRAFT_INPUT: InputPolicy = {
	enabled: true,
	acceptsText: true,
	acceptsImages: true,
	acceptsFiles: true,
}

/** Create immutable action metadata. */
function action(
	type: InteractionActionType,
	label: string,
	payloadPolicy: PayloadPolicy = "none",
	appearance: InteractionActionDefinition["appearance"] = "primary",
): InteractionActionDefinition {
	return { type, label, appearance, payloadPolicy }
}

/** Create one immutable interaction definition. */
function define(
	kind: InteractionKind,
	taskAsk: InteractionDefinition["taskAsk"],
	actions: readonly InteractionActionDefinition[],
	input: InputPolicy = DRAFT_INPUT,
): InteractionDefinition {
	return { kind, taskAsk, presentationKind: kind, input, actions }
}

const REPLY_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "reply" }
const RESUME_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "resume" }
const APPROVAL_ACTIONS = [action("approve", "Approve", "draft"), action("reject", "Reject", "draft", "danger")]

const DEFINITIONS: Readonly<Record<InteractionKind, InteractionDefinition>> = {
	tool_approval: define("tool_approval", "tool", APPROVAL_ACTIONS),
	command_approval: define("command_approval", "command", APPROVAL_ACTIONS),
	browser_approval: define("browser_approval", "browser_action_launch", APPROVAL_ACTIONS),
	mcp_approval: define("mcp_approval", "use_mcp_server", APPROVAL_ACTIONS),
	subagent_approval: define("subagent_approval", "use_subagents", APPROVAL_ACTIONS),
	spawn_task_approval: define("spawn_task_approval", "spawn_task", APPROVAL_ACTIONS),
	focus_chain_change: define("focus_chain_change", "focus_chain_change", [
		action("approve", "Approve", "draft_and_selection"),
		action("reject", "Reject", "draft", "danger"),
	]),
	new_task: define("new_task", "new_task", [action("approve", "Start New Task", "draft"), action("reject", "Reject", "draft")]),
	report_bug: define("report_bug", "report_bug", [action("confirm_utility", "Report Bug", "draft")]),
	condense: define("condense", "condense", [action("confirm_utility", "Condense Conversation", "draft")]),
	followup: define("followup", "followup", [action("reply", "Reply", "draft")], REPLY_INPUT),
	plan_response: define("plan_response", "plan_mode_respond", [action("reply", "Reply", "draft")], REPLY_INPUT),
	qna_response: define("qna_response", "qna_respond", [action("reply", "Reply", "draft")], REPLY_INPUT),
	generate_report: define("generate_report", "generate_report", [action("reply", "Reply", "draft")], REPLY_INPUT),
	status_acknowledgment: define("status_acknowledgment", "status_acknowledgment", [
		action("acknowledge", "Acknowledge", "draft"),
		action("stop", "Stop", "draft", "danger"),
	]),
	error_retry: define("error_retry", "api_req_failed", [
		action("retry", "Retry", "draft"),
		action("start_new_task", "Start New Task", "draft"),
	]),
	mistake_limit: define("mistake_limit", "mistake_limit_reached", [
		action("process_anyway", "Process Anyway", "draft"),
		action("start_new_task", "Start New Task", "draft"),
	]),
	completion: define(
		"completion",
		"completion_result",
		[action("reply", "Reply", "draft"), action("start_new_task", "Start New Task", "draft")],
		REPLY_INPUT,
	),
	resume: define("resume", "resume_task", [action("resume", "Resume", "draft")], RESUME_INPUT),
}

/** Return the immutable definition for one interaction kind. */
export function getInteraction(kind: InteractionKind): InteractionDefinition {
	return DEFINITIONS[kind]
}
