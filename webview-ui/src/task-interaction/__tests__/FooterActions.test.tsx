import type { TaskViewState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FooterActions } from "../FooterActions"

/** Create one tool approval view with exact causal identity. */
function approvalView(): TaskViewState {
	return {
		taskId: "task-1",
		phase: "awaiting_approval",
		stateRevision: 8,
		activeInteraction: {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "tool_approval",
			status: "awaiting",
			stateRevision: 8,
			taskAsk: "tool",
			presentationKind: "tool_approval",
			askMessageTs: 100,
		},
		input: { enabled: true, acceptsText: true, acceptsImages: true, acceptsFiles: true },
		footer: {
			actions: [
				{ type: "approve", label: "Approve", appearance: "primary", enabled: true, payloadPolicy: "draft" },
				{ type: "reject", label: "Reject", appearance: "danger", enabled: true, payloadPolicy: "draft" },
			],
		},
	}
}

describe("FooterActions", () => {
	it("dispatches exact causal identity with draft and selection", async () => {
		const dispatch = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		render(
			<FooterActions
				dispatch={dispatch}
				draft={{ text: "use smaller steps", images: ["image"], files: ["file"] }}
				selection={{ values: ["item-1"] }}
				view={approvalView()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Approve" }))

		await waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
		expect(dispatch).toHaveBeenCalledWith({
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "approve",
			stateRevision: 8,
			draft: { text: "use smaller steps", images: ["image"], files: ["file"] },
			selection: { values: ["item-1"] },
		})
	})

	it("dispatches projected cancel through the task command boundary", async () => {
		const view = approvalView()
		delete view.activeInteraction
		view.phase = "streaming"
		view.footer.actions = [{ type: "cancel", label: "Cancel", appearance: "danger", enabled: true, payloadPolicy: "none" }]
		const dispatchTaskAction = vi.fn(async () => undefined)

		render(
			<FooterActions
				dispatch={vi.fn()}
				dispatchTaskAction={dispatchTaskAction}
				draft={{ text: "", images: [], files: [] }}
				view={view}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		await waitFor(() => expect(dispatchTaskAction).toHaveBeenCalledWith("cancel"))
	})
})
