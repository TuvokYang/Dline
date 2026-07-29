import type { ComponentType, ReactElement } from "react"
import {
	ApprovalRenderer,
	CommandRenderer,
	CompletionRenderer,
	ConversationRenderer,
	ErrorRenderer,
	FocusChainRenderer,
	type PresentationProps,
	ReportRenderer,
	ResumeRenderer,
} from "./renderers/PresentationRenderers"

export const PRESENTATION_KINDS = [
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
] as const

export type PresentationKind = (typeof PRESENTATION_KINDS)[number]

const RENDERERS = {
	tool_approval: ApprovalRenderer,
	command_approval: CommandRenderer,
	browser_approval: ApprovalRenderer,
	mcp_approval: ApprovalRenderer,
	subagent_approval: ApprovalRenderer,
	spawn_task_approval: ApprovalRenderer,
	focus_chain_change: FocusChainRenderer,
	new_task: ConversationRenderer,
	report_bug: ReportRenderer,
	condense: ConversationRenderer,
	followup: ConversationRenderer,
	make_plan: ConversationRenderer,
	qna_response: ConversationRenderer,
	generate_report: ReportRenderer,
	status_acknowledgment: ConversationRenderer,
	error_retry: ErrorRenderer,
	mistake_limit: ErrorRenderer,
	completion: CompletionRenderer,
	resume: ResumeRenderer,
} satisfies Record<PresentationKind, ComponentType<PresentationProps>>

/** Return whether a backend presentation identifier is registered. */
export function isPresentationKind(value: string): value is PresentationKind {
	return PRESENTATION_KINDS.some((kind) => kind === value)
}

/** Render one explicitly registered presentation without a generic fallback. */
export function renderPresentation(kind: PresentationKind, props: PresentationProps): ReactElement {
	const Renderer = RENDERERS[kind]
	return (
		<div data-testid={`presentation-${kind}`}>
			<Renderer {...props} />
		</div>
	)
}
