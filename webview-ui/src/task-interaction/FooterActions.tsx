import type { TaskViewState } from "@shared/ExtensionMessage"
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
} from "./types"

/** Props for the backend-projected task footer. */
export interface FooterActionsProps {
	view: TaskViewState
	draft: InteractionDraft
	selection?: InteractionSelection
	dispatch: DispatchInteraction
	dispatchTaskAction?: (action: "cancel" | "retry") => Promise<void>
	onDraftAccepted?: (settlement: AcceptedInteractionSettlement) => void
}

/** Render and dispatch footer actions without inspecting message history. */
export function FooterActions({ view, draft, selection, dispatch, dispatchTaskAction, onDraftAccepted }: FooterActionsProps) {
	const [pending, setPending] = useState(false)
	const actions = view.footer.actions.filter((action) => action.type !== "reply" || view.input.enterAction !== "reply")
	if (actions.length === 0) {
		return null
	}

	return (
		<div className="flex mx-3.5 border border-(--vscode-panel-border) rounded gap-1.5">
			{actions.map((action) => {
				const targetsTask = action.type === "cancel" || action.dispatchTarget === "task"
				const dispatcherAvailable = targetsTask ? Boolean(dispatchTaskAction) : Boolean(view.activeInteraction)
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
								if (!dispatchTaskAction || (action.type !== "cancel" && action.type !== "retry")) {
									return
								}
								setPending(true)
								void dispatchTaskAction(action.type).finally(() => setPending(false))
								return
							}
							const capturedDraft = captureInteractionDraft(draft)
							const request = buildInteractionRequest(view, action.type, capturedDraft, selection)
							if (!request) {
								return
							}
							setPending(true)
							void dispatch(request)
								.then((response) => {
									if (response.accepted) {
										onDraftAccepted?.(createAcceptedInteractionSettlement(request, capturedDraft))
									}
								})
								.finally(() => setPending(false))
						}}
						role="button">
						{action.label}
					</VSCodeButton>
				)
			})}
		</div>
	)
}
