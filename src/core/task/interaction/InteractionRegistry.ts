import type {
	InputPolicy,
	InteractionActionDefinition,
	InteractionActionType,
	InteractionContinuation,
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
	"make_plan",
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
	continuation: InteractionContinuation = "none",
): InteractionDefinition {
	return { kind, taskAsk, presentationKind: kind, input, actions, continuation }
}

const REPLY_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "reply" }
const RESUME_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "resume" }
const APPROVAL_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "reject" }
const RETRY_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "retry" }
const ACKNOWLEDGE_INPUT: InputPolicy = { ...DRAFT_INPUT, enterAction: "acknowledge" }
const APPROVAL_ACTIONS = [action("approve", "Approve", "draft"), action("reject", "Reject", "draft", "danger")]

const DEFINITIONS: Readonly<Record<InteractionKind, InteractionDefinition>> = {
	tool_approval: define("tool_approval", "tool", APPROVAL_ACTIONS, APPROVAL_INPUT),
	command_approval: define("command_approval", "command", APPROVAL_ACTIONS, APPROVAL_INPUT),
	browser_approval: define("browser_approval", "browser_action_launch", APPROVAL_ACTIONS, APPROVAL_INPUT),
	mcp_approval: define("mcp_approval", "use_mcp_server", APPROVAL_ACTIONS, APPROVAL_INPUT),
	subagent_approval: define("subagent_approval", "use_subagents", APPROVAL_ACTIONS, APPROVAL_INPUT),
	spawn_task_approval: define("spawn_task_approval", "spawn_task", APPROVAL_ACTIONS, APPROVAL_INPUT),
	focus_chain_change: define(
		"focus_chain_change",
		"focus_chain_change",
		[action("approve", "Approve", "draft_and_selection"), action("reject", "Reject", "draft", "danger")],
		APPROVAL_INPUT,
	),
	new_task: define("new_task", "new_task", [action("approve", "Start New Task", "draft"), action("reject", "Reject", "draft")]),
	report_bug: define("report_bug", "report_bug", [action("confirm_utility", "Report Bug", "draft")]),
	condense: define("condense", "condense", [action("confirm_utility", "Condense Conversation", "draft")]),
	followup: define("followup", "followup", [], REPLY_INPUT, "handler"),
	make_plan: define("make_plan", "make_plan", [], REPLY_INPUT, "handler"),
	qna_response: define("qna_response", "qna_respond", [], REPLY_INPUT, "handler"),
	generate_report: define("generate_report", "generate_report", [], REPLY_INPUT, "handler"),
	status_acknowledgment: define(
		"status_acknowledgment",
		"status_acknowledgment",
		[action("acknowledge", "Acknowledge", "draft"), action("stop", "Stop", "draft", "danger")],
		ACKNOWLEDGE_INPUT,
	),
	error_retry: define(
		"error_retry",
		"api_req_failed",
		[action("retry", "Retry", "draft"), action("start_new_task", "Start New Task", "draft")],
		RETRY_INPUT,
	),
	mistake_limit: define("mistake_limit", "mistake_limit_reached", [
		action("process_anyway", "Process Anyway", "draft"),
		action("start_new_task", "Start New Task", "draft"),
	]),
	completion: define(
		"completion",
		"completion_result",
		[action("start_new_task", "Start New Task", "draft")],
		REPLY_INPUT,
		"completion",
	),
	resume: define("resume", "resume_task", [action("resume", "Resume", "draft")], RESUME_INPUT, "resume"),
}

/** Return the immutable definition for one interaction kind. */
export function getInteraction(kind: InteractionKind): InteractionDefinition {
	return DEFINITIONS[kind]
}
