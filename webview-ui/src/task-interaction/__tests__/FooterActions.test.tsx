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
				{
					type: "approve",
					label: "Approve",
					appearance: "primary",
					enabled: true,
					payloadPolicy: "draft",
					dispatchTarget: "interaction",
				},
				{
					type: "reject",
					label: "Reject",
					appearance: "danger",
					enabled: true,
					payloadPolicy: "draft",
					dispatchTarget: "interaction",
				},
			],
		},
	}
}

describe("FooterActions", () => {
	it("dispatches exact causal identity and settles the captured draft only when accepted", async () => {
		const dispatch = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		const onDraftAccepted = vi.fn()
		const draft = {
			text: "use smaller steps",
			images: ["image"],
			files: ["file"],
			activeQuote: "quoted context",
		}
		render(
			<FooterActions
				dispatch={dispatch}
				draft={draft}
				onDraftAccepted={onDraftAccepted}
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
		await waitFor(() =>
			expect(onDraftAccepted).toHaveBeenCalledWith({
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				stateRevision: 8,
				draft,
			}),
		)
	})

	it("retains the draft when the backend rejects the interaction", async () => {
		const dispatch = vi.fn(async () => ({ accepted: false, result: "stale interaction" }))
		const onDraftAccepted = vi.fn()
		render(
			<FooterActions
				dispatch={dispatch}
				draft={{ text: "keep me", images: ["image"], files: ["file"] }}
				onDraftAccepted={onDraftAccepted}
				view={approvalView()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Reject" }))

		await waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
		expect(onDraftAccepted).not.toHaveBeenCalled()
		expect(await screen.findByRole("alert")).toHaveTextContent("Interaction was not accepted: stale interaction")
		expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled()
	})

	it("confirms Condense Conversation without submitting or settling the current draft", async () => {
		const dispatch = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		const onDraftAccepted = vi.fn()
		const view = approvalView()
		if (!view.activeInteraction) throw new Error("Expected active interaction")
		view.activeInteraction = {
			...view.activeInteraction,
			kind: "condense",
			presentationKind: "condense",
			taskAsk: "condense",
		}
		view.footer.actions = [
			{
				type: "confirm_utility",
				label: "Condense Conversation",
				appearance: "primary",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "interaction",
			},
			{
				type: "reject",
				label: "Regenerate Summary",
				appearance: "secondary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
		]

		render(
			<FooterActions
				dispatch={dispatch}
				draft={{ text: "preserve this draft", images: ["image"], files: ["file"] }}
				onDraftAccepted={onDraftAccepted}
				view={view}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Condense Conversation" }))

		await waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
		expect(dispatch).toHaveBeenCalledWith({
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "confirm_utility",
			stateRevision: 8,
			draft: undefined,
			selection: undefined,
		})
		expect(onDraftAccepted).not.toHaveBeenCalled()
	})

	it("submits and settles feedback through Regenerate Summary", async () => {
		const dispatch = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		const onDraftAccepted = vi.fn()
		const view = approvalView()
		if (!view.activeInteraction) throw new Error("Expected active interaction")
		view.activeInteraction = {
			...view.activeInteraction,
			kind: "condense",
			presentationKind: "condense",
			taskAsk: "condense",
		}
		view.input.enterAction = "reject"
		view.footer.actions = [
			{
				type: "confirm_utility",
				label: "Condense Conversation",
				appearance: "primary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
			{
				type: "reject",
				label: "Regenerate Summary",
				appearance: "secondary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
		]
		const draft = { text: "Keep the deployment details", images: ["image"], files: ["file"] }

		render(<FooterActions dispatch={dispatch} draft={draft} onDraftAccepted={onDraftAccepted} view={view} />)
		fireEvent.click(screen.getByRole("button", { name: "Regenerate Summary" }))

		await waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
		expect(dispatch).toHaveBeenCalledWith({
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "reject",
			stateRevision: 8,
			draft: { text: "Keep the deployment details", images: ["image"], files: ["file"] },
			selection: undefined,
		})
		expect(onDraftAccepted).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining(draft) }))
	})

	it("shows an interaction dispatch failure and restores the action", async () => {
		const dispatch = vi.fn(async () => {
			throw new Error("dispatch unavailable")
		})
		render(<FooterActions dispatch={dispatch} draft={{ text: "keep me", images: [], files: [] }} view={approvalView()} />)

		fireEvent.click(screen.getByRole("button", { name: "Approve" }))

		expect(await screen.findByRole("alert")).toHaveTextContent("dispatch unavailable")
		await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled())
	})

	it("dispatches projected cancel through the task command boundary", async () => {
		const view = approvalView()
		delete view.activeInteraction
		view.phase = "streaming"
		view.footer.actions = [
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		]
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

		await waitFor(() => expect(dispatchTaskAction).toHaveBeenCalledWith(expect.objectContaining({ type: "cancel" })))
	})

	it("dispatches Continue in Background with the projected command activity identity", async () => {
		const view = approvalView()
		delete view.activeInteraction
		view.phase = "executing"
		view.footer.actions = [
			{
				type: "continue_in_background",
				label: "Continue in Background",
				appearance: "secondary",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
				activityId: "command-1",
			},
		]
		const dispatchTaskAction = vi.fn(async () => undefined)

		render(
			<FooterActions
				dispatch={vi.fn()}
				dispatchTaskAction={dispatchTaskAction}
				draft={{ text: "", images: [], files: [] }}
				view={view}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Continue in Background" }))

		await waitFor(() =>
			expect(dispatchTaskAction).toHaveBeenCalledWith(
				expect.objectContaining({ type: "continue_in_background", activityId: "command-1" }),
			),
		)
	})

	it("shows a task action dispatch failure and restores the action", async () => {
		const view = approvalView()
		delete view.activeInteraction
		view.phase = "streaming"
		view.footer.actions = [
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		]
		const dispatchTaskAction = vi.fn(async () => {
			throw new Error("cancel unavailable")
		})

		render(
			<FooterActions
				dispatch={vi.fn()}
				dispatchTaskAction={dispatchTaskAction}
				draft={{ text: "", images: [], files: [] }}
				view={view}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(await screen.findByRole("alert")).toHaveTextContent("cancel unavailable")
		await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled())
	})

	it("keeps the explicit Resume button when Enter can also resume", () => {
		const view = approvalView()
		if (!view.activeInteraction) {
			throw new Error("Expected active interaction")
		}
		view.activeInteraction = { ...view.activeInteraction, kind: "resume", presentationKind: "resume", taskAsk: "resume_task" }
		view.input.enterAction = "resume"
		view.footer.actions = [
			{
				type: "resume",
				label: "Resume",
				appearance: "primary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
		]

		render(<FooterActions dispatch={vi.fn()} draft={{ text: "", images: [], files: [] }} view={view} />)

		expect(screen.getByRole("button", { name: "Resume" })).toBeVisible()
	})
})
