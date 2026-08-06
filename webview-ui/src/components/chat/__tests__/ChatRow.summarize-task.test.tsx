import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		backgroundEditEnabled: true,
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

const baseProps = {
	isLast: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

describe("ChatRow summarizeTask rendering", () => {
	it("renders the streamed summary content while expanded", () => {
		const content = "The user asked to fix the web tools auth issue and the work is in progress."
		render(
			<ChatRowContent
				{...baseProps}
				isExpanded={true}
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({ tool: "summarizeTask", content }),
				}}
			/>,
		)

		expect(screen.getByText("Summary:")).toBeInTheDocument()
		expect(screen.getByText(content)).toBeInTheDocument()
	})

	it("caps the expanded summary at 80% of the viewport with internal scrolling", () => {
		render(
			<ChatRowContent
				{...baseProps}
				isExpanded={true}
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({ tool: "summarizeTask", content: "long summary content" }),
				}}
			/>,
		)

		const scrollContainer = screen.getByText("long summary content").parentElement
		expect(scrollContainer).not.toBeNull()
		expect(scrollContainer).toHaveClass("max-h-[80vh]")
		expect(scrollContainer).toHaveClass("overflow-y-auto")
	})
})
