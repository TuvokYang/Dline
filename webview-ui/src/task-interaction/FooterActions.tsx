import type { TaskViewAction, TaskViewState } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import {
	type AcceptedInteractionSettlement,
	buildInteractionRequest,
	captureInteractionDraft,
	createAcceptedInteractionSettlement,
	type DispatchInteraction,
	type InteractionDraft,
	type InteractionSelection,
	type PendingSuccessorDraftTransfer,
} from "./types"

/** Props for the backend-projected task footer. */
export interface FooterActionsProps {
	view: TaskViewState
	draft: InteractionDraft
	selection?: InteractionSelection
	dispatch: DispatchInteraction
	dispatchTaskAction?: (action: TaskViewAction) => Promise<void>
	onDraftAccepted?: (settlement: AcceptedInteractionSettlement) => void
	onSuccessorAccepted?: (transfer: PendingSuccessorDraftTransfer) => void
	successorContext?: string
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "The action could not be completed."
}

/** Render and dispatch footer actions without inspecting message history. */
export function FooterActions({
	view,
	draft,
	selection,
	dispatch,
	dispatchTaskAction,
	onDraftAccepted,
	onSuccessorAccepted,
	successorContext,
}: FooterActionsProps) {
	const [pending, setPending] = useState(false)
	const errorScope = `${view.taskId}:${view.stateRevision}:${view.activeInteraction?.interactionId ?? ""}`
	const [errorState, setErrorState] = useState<{ scope: string; message: string }>()
	const error = errorState?.scope === errorScope ? errorState.message : undefined
	const setError = (message?: string) => setErrorState(message ? { scope: errorScope, message } : undefined)
	const actions = view.footer.actions.filter((action) => action.type !== "reply" || view.input.enterAction !== "reply")
	if (actions.length === 0) {
		return null
	}

	return (
		<div className="mx-3.5">
			{error ? (
				<div className="mb-1 text-xs text-(--vscode-errorForeground)" role="alert">
					{error}
				</div>
			) : null}
			<div className="flex border border-(--vscode-panel-border) rounded gap-1.5">
				{actions.map((action) => {
					const targetsTask = action.dispatchTarget === "task"
					const carriesDraft = action.payloadPolicy === "draft" || action.payloadPolicy === "draft_and_selection"
					const dispatcherAvailable = targetsTask ? Boolean(dispatchTaskAction) : Boolean(view.activeInteraction)
					const startsSuccessor = view.activeInteraction?.kind === "new_task" && action.type === "approve"
					const buttonDisabled = !action.enabled || pending || !dispatcherAvailable
					return (
						<VSCodeButton
							appearance={action.appearance === "primary" ? "primary" : "secondary"}
							aria-disabled={buttonDisabled}
							aria-label={action.label}
							className="flex-1 focus:ring-2 focus:ring-[--vscode-focusBorder] rounded"
							disabled={buttonDisabled}
							key={action.type}
							onClick={() => {
								if (pending) {
									return
								}
								if (targetsTask) {
									const supportedTaskAction =
										action.type === "cancel" ||
										action.type === "retry" ||
										(action.type === "continue_in_background" && Boolean(action.activityId))
									if (!dispatchTaskAction || !supportedTaskAction) {
										return
									}
									setError(undefined)
									setPending(true)
									void dispatchTaskAction(action)
										.catch((cause: unknown) => setError(errorMessage(cause)))
										.finally(() => setPending(false))
									return
								}
								const capturedDraft = captureInteractionDraft(draft)
								const request = buildInteractionRequest(view, action.type, capturedDraft, selection)
								if (!request) {
									return
								}
								setError(undefined)
								setPending(true)
								void dispatch(request)
									.then((response) => {
										if (!response.accepted) {
											setError(`Interaction was not accepted: ${response.result || "unknown error"}`)
											return
										}
										if (carriesDraft) {
											onDraftAccepted?.(createAcceptedInteractionSettlement(request, capturedDraft))
										}
										if (startsSuccessor && successorContext) {
											onSuccessorAccepted?.({
												sourceTaskId: request.taskId,
												context: successorContext,
												draft: capturedDraft,
											})
										}
									})
									.catch((cause: unknown) => setError(errorMessage(cause)))
									.finally(() => setPending(false))
							}}
							role="button">
							{action.label}
						</VSCodeButton>
					)
				})}
			</div>
		</div>
	)
}
