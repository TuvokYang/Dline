import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dline/common"
import { useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { FooterActions } from "./FooterActions"
import { isPresentationKind, renderPresentation } from "./renderer-registry"
import type { DispatchInteraction, InteractionDraft } from "./types"

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
}

const EMPTY_DRAFT: InteractionDraft = { text: "", images: [], files: [] }

async function dispatchTaskAction(action: "cancel"): Promise<void> {
	if (action === "cancel") {
		await TaskServiceClient.cancelTask(EmptyRequest.create({}))
	}
}

/** Bind one backend interaction projection to its exact ask presentation anchor. */
export function InteractionHost({ messages, view, dispatch, draft = EMPTY_DRAFT, showTimeline = true }: InteractionHostProps) {
	const [selection, setSelection] = useState<string[]>([])
	const interaction = view.activeInteraction
	const anchor = interaction
		? messages.find((message) => message.ts === interaction.askMessageTs && message.type === "ask")
		: undefined
	const presentationKind = interaction?.presentationKind
	const supported = presentationKind ? isPresentationKind(presentationKind) : false

	return (
		<section>
			{showTimeline &&
				messages.map((message) => {
					if (interaction && message.ts === interaction.askMessageTs) {
						return null
					}
					return message.type === "say" ? (
						<SayView key={message.ts} message={message} />
					) : (
						<AskView key={message.ts} message={message} />
					)
				})}
			{interaction && (!anchor || !supported) ? (
				<div role="alert">Interaction is out of sync</div>
			) : anchor && presentationKind && isPresentationKind(presentationKind) ? (
				<>
					{showTimeline
						? renderPresentation(presentationKind, { message: anchor, selection, onSelectionChange: setSelection })
						: null}
					<FooterActions
						dispatch={dispatch}
						dispatchTaskAction={dispatchTaskAction}
						draft={draft}
						selection={{ values: selection }}
						view={view}
					/>
				</>
			) : (
				<FooterActions dispatch={dispatch} dispatchTaskAction={dispatchTaskAction} draft={draft} view={view} />
			)}
		</section>
	)
}
