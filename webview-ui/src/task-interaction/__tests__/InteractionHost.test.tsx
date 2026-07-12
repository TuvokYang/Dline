import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { InteractionHost } from "../InteractionHost"

/** Create one active interaction view anchored to timestamp 100. */
function taskView(): TaskViewState {
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

const ASK: ClineMessage = { ts: 100, type: "ask", ask: "tool", text: "Approve write" }
const SAY: ClineMessage = { ts: 90, type: "say", say: "text", text: "status text" }

describe("InteractionHost", () => {
	it("renders say content without actions when no interaction exists", () => {
		const view = taskView()
		delete view.activeInteraction
		view.footer.actions = []

		render(<InteractionHost dispatch={vi.fn()} messages={[SAY]} view={view} />)

		expect(screen.getByText("status text")).toBeVisible()
		expect(screen.queryByRole("button")).toBeNull()
	})

	it("renders matching ask presentation and footer actions", () => {
		render(<InteractionHost dispatch={vi.fn()} messages={[SAY, ASK]} view={taskView()} />)

		expect(screen.getByText("Approve write")).toBeVisible()
		expect(screen.getByRole("button", { name: "Approve" })).toBeVisible()
	})

	it("keeps ask read-only without an active interaction", () => {
		const view = taskView()
		delete view.activeInteraction
		view.footer.actions = []

		render(<InteractionHost dispatch={vi.fn()} messages={[ASK]} view={view} />)

		expect(screen.getByText("Approve write")).toBeVisible()
		expect(screen.queryByRole("button")).toBeNull()
	})

	it("dispatches host-owned focus-chain selection with approve", async () => {
		const dispatch = vi.fn(async () => ({ accepted: true, result: "accepted" }))
		const view = taskView()
		if (!view.activeInteraction) {
			throw new Error("Expected active interaction")
		}
		view.activeInteraction = {
			...view.activeInteraction,
			kind: "focus_chain_change",
			presentationKind: "focus_chain_change",
			taskAsk: "focus_chain_change",
		}
		const message: ClineMessage = {
			ts: 100,
			type: "ask",
			ask: "focus_chain_change",
			text: JSON.stringify({ plan: "# Plan\n- [ ] First item\n- [ ] Second item", reason: "Review" }),
		}
		render(<InteractionHost dispatch={dispatch} messages={[message]} view={view} />)

		fireEvent.click(screen.getByLabelText("Second item"))
		fireEvent.click(screen.getByRole("button", { name: "Approve" }))

		await waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
		expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ selection: { values: ["1"] } }))
	})

	it("reports synchronization failure when the ask anchor is missing", () => {
		render(<InteractionHost dispatch={vi.fn()} messages={[SAY]} view={taskView()} />)

		expect(screen.getByRole("alert")).toHaveTextContent("Interaction is out of sync")
		expect(screen.queryByRole("button")).toBeNull()
	})
})
