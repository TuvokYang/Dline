import type { TaskViewState } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { buildInteractionRequest, type DispatchInteraction, type InteractionDraft, type InteractionSelection } from "./types"

/** Props for the backend-projected task footer. */
export interface FooterActionsProps {
	view: TaskViewState
	draft: InteractionDraft
	selection?: InteractionSelection
	dispatch: DispatchInteraction
	dispatchTaskAction?: (action: "cancel") => Promise<void>
}

/** Render and dispatch footer actions without inspecting message history. */
export function FooterActions({ view, draft, selection, dispatch, dispatchTaskAction }: FooterActionsProps) {
	const [pending, setPending] = useState(false)
	if (view.footer.actions.length === 0) {
		return null
	}

	return (
		<div className="flex mx-3.5 border border-(--vscode-panel-border) rounded gap-1.5">
			{view.footer.actions.map((action) => (
				<VSCodeButton
					appearance={action.appearance === "primary" ? "primary" : "secondary"}
					aria-label={action.label}
					className="flex-1 focus:ring-2 focus:ring-[--vscode-focusBorder] rounded"
					disabled={!action.enabled || pending}
					key={action.type}
					onClick={() => {
						if (pending) {
							return
						}
						if (action.type === "cancel") {
							if (!dispatchTaskAction) {
								return
							}
							setPending(true)
							void dispatchTaskAction("cancel").finally(() => setPending(false))
							return
						}
						const request = buildInteractionRequest(view, action.type, draft, selection)
						if (!request) {
							return
						}
						setPending(true)
						void dispatch(request).finally(() => setPending(false))
					}}
					role="button">
					{action.label}
				</VSCodeButton>
			))}
		</div>
	)
}
