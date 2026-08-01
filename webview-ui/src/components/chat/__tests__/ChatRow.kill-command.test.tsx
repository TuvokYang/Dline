import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

void React

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

describe("ChatRow kill command result", () => {
	it("renders the exact function identity without adding an interaction button", () => {
		render(
			<ChatRowContent
				isExpanded={false}
				isLast
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					text: JSON.stringify({
						tool: "killCommand",
						path: "function-execute-command",
						content: "Termination was requested for the running command.",
					}),
				}}
				onSetQuote={vi.fn()}
				onToggleExpand={vi.fn()}
			/>,
		)

		expect(screen.getByText("Dline requested command termination:")).toBeVisible()
		expect(screen.getByText("function-execute-command")).toBeVisible()
		expect(screen.queryByRole("button")).toBeNull()
	})
})
