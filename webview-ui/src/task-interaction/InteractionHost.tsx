import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dline/common"
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

type TaskLevelAction = "cancel"

async function dispatchTaskAction(_action: TaskLevelAction): Promise<void> {
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
	const taskActionDispatcher = (action: TaskLevelAction) => dispatchTaskAction(action)
	const taskOnlyView: TaskViewState = {
		...view,
		activeInteraction: undefined,
		input: { enabled: false, acceptsText: false, acceptsImages: false, acceptsFiles: false },
		footer: { actions: view.footer.actions.filter((action) => action.type === "cancel") },
	}

	return (
		<section>
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
