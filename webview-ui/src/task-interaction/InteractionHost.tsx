import type { ClineMessage, TaskViewAction, TaskViewState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dline/common"
import { AskResponseRequest, MoveCommandToBackgroundRequest } from "@shared/proto/dline/task"
import { useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { FooterActions } from "./FooterActions"
import { isPresentationKind, renderPresentation } from "./renderer-registry"
import {
	type AcceptedInteractionSettlement,
	type DispatchInteraction,
	findActiveInteractionAnchor,
	type InteractionDraft,
} from "./types"

/** Presentation-only props for a say timeline row. */
export interface SayViewProps {
	message: ClineMessage
}

/** Presentation-only say row with no action or dispatch capability. */
export function SayView({ message }: SayViewProps) {
	return <div>{message.text}</div>
}

/** Presentation-only props for an ask timeline row. */
export interface AskViewProps {
	message: ClineMessage
}

/** Read-only ask presentation; actions are rendered only by the host footer. */
export function AskView({ message }: AskViewProps) {
	return <div>{message.text}</div>
}

/** Props for the task interaction synchronization boundary. */
export interface InteractionHostProps {
	messages: ClineMessage[]
	view: TaskViewState
	dispatch: DispatchInteraction
	draft?: InteractionDraft
	showTimeline?: boolean
	onDraftAccepted?: (settlement: AcceptedInteractionSettlement) => void
}

const EMPTY_DRAFT: InteractionDraft = { text: "", images: [], files: [], activeQuote: null }

const DIAGNOSTIC_MESSAGES = {
	interaction_anchor_missing: "Dline could not restore the saved interaction message. The task remains saved for recovery.",
	interaction_anchor_is_say: "Dline found an invalid saved interaction message. The task remains saved for recovery.",
} as const

async function dispatchTaskAction(view: TaskViewState, action: TaskViewAction): Promise<void> {
	if (action.type === "retry") {
		await TaskServiceClient.askResponse(AskResponseRequest.create({ responseType: "retry" }))
		return
	}
	if (action.type === "continue_in_background") {
		if (!action.activityId) {
			throw new Error("The foreground command is no longer available to continue in the background.")
		}
		const response = await TaskServiceClient.moveCommandToBackground(
			MoveCommandToBackgroundRequest.create({ taskId: view.taskId, activityId: action.activityId }),
		)
		if (!response.moved) {
			throw new Error("The foreground command is no longer available to continue in the background.")
		}
		return
	}
	await TaskServiceClient.cancelTask(EmptyRequest.create({}))
}

/** Bind one backend interaction projection to its exact ask presentation anchor. */
export function InteractionHost({
	messages,
	view,
	dispatch,
	draft = EMPTY_DRAFT,
	showTimeline = true,
	onDraftAccepted,
}: InteractionHostProps) {
	const [selection, setSelection] = useState<string[]>([])
	const interaction = view.activeInteraction
	const anchor = findActiveInteractionAnchor(messages, view)
	const presentationKind = interaction?.presentationKind
	const supported = presentationKind ? isPresentationKind(presentationKind) : false
	const taskActionDispatcher = (action: TaskViewAction) => dispatchTaskAction(view, action)
	const taskOnlyView: TaskViewState = {
		...view,
		activeInteraction: undefined,
		input: { enabled: false, acceptsText: false, acceptsImages: false, acceptsFiles: false },
		footer: { actions: view.footer.actions.filter((action) => action.dispatchTarget === "task") },
	}

	return (
		<section>
			{view.diagnostic ? (
				<div className="mx-3.5 mb-1 text-xs text-(--vscode-errorForeground)" role="alert">
					{DIAGNOSTIC_MESSAGES[view.diagnostic.code]}
				</div>
			) : null}
			{showTimeline &&
				messages.map((message, index) => {
					if (message === anchor && supported) {
						return null
					}
					return message.type === "say" ? (
						<SayView key={`${message.ts}:${message.interactionId ?? ""}:${index}`} message={message} />
					) : (
						<AskView key={`${message.ts}:${message.interactionId ?? ""}:${index}`} message={message} />
					)
				})}
			{interaction && (!anchor || !supported) ? (
				<FooterActions
					dispatch={dispatch}
					dispatchTaskAction={taskActionDispatcher}
					draft={draft}
					onDraftAccepted={onDraftAccepted}
					view={taskOnlyView}
				/>
			) : anchor && presentationKind && isPresentationKind(presentationKind) ? (
				<>
					{showTimeline
						? renderPresentation(presentationKind, { message: anchor, selection, onSelectionChange: setSelection })
						: null}
					<FooterActions
						dispatch={dispatch}
						dispatchTaskAction={taskActionDispatcher}
						draft={draft}
						onDraftAccepted={onDraftAccepted}
						selection={{ values: selection }}
						view={view}
					/>
				</>
			) : (
				<FooterActions
					dispatch={dispatch}
					dispatchTaskAction={taskActionDispatcher}
					draft={draft}
					onDraftAccepted={onDraftAccepted}
					view={view}
				/>
			)}
		</section>
	)
}
