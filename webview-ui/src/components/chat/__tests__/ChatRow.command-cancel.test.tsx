import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

void React

const cancelTaskActivities = vi.fn(async () => ["command-1"])

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		backgroundEditEnabled: false,
		mcpServers: [],
		mcpMarketplaceCatalog: [],
		onRelinquishControl: () => () => undefined,
		vscodeTerminalExecutionMode: "backgroundExec",
		clineMessages: [],
		showFeatureTips: false,
		taskViewState: undefined,
		currentTaskItem: { id: "task-1" },
	}),
}))

vi.mock("../activity/useTaskActivities", () => ({
	cancelTaskActivities: (...args: unknown[]) => cancelTaskActivities(...args),
}))

const baseProps = {
	isExpanded: false,
	isLast: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

describe("ChatRow command cancellation", () => {
	beforeEach(() => {
		cancelTaskActivities.mockClear()
	})

	it("cancels the exact running command activity from the main message card", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 1,
					type: "say",
					say: "command",
					text: "sleep 10",
					commandStatus: "running",
					activityId: "command-1",
				}}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["command-1"])
	})

	it("does not expose a global cancellation fallback without an activity identity", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 2,
					type: "say",
					say: "command",
					text: "sleep 10",
					commandStatus: "running",
				}}
			/>,
		)

		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
	})

	it("renders the terminal cancelled state without a cancellation action", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 3,
					type: "say",
					say: "command",
					text: "sleep 10",
					commandStatus: "cancelled",
					activityId: "command-1",
				}}
			/>,
		)

		expect(screen.getByText("Cancelled")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
	})
})
