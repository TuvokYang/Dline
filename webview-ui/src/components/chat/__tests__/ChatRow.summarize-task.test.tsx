import { fireEvent, render, screen } from "@testing-library/react"
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

	it("renders a retrying compaction without presenting the partial text as a completed summary", () => {
		render(
			<ChatRowContent
				{...baseProps}
				isExpanded={true}
				message={{
					ts: 10,
					type: "say",
					say: "tool",
					partial: true,
					text: JSON.stringify({
						tool: "summarizeTask",
						content: "partial summary that must not be applied",
						compactionStatus: "retrying",
						retryAttempt: 2,
						maxRetryAttempts: 3,
					}),
				}}
			/>,
		)

		expect(screen.getByText(/Compaction was interrupted.*retrying/i)).toBeInTheDocument()
		expect(screen.getByText(/attempt 2 of 3/i)).toBeInTheDocument()
		expect(screen.getByText("Partial summary (not applied):")).toBeInTheDocument()
		expect(screen.queryByText("Summary:")).not.toBeInTheDocument()
	})

	it("renders an actionable failed compaction state", () => {
		render(
			<ChatRowContent
				{...baseProps}
				isExpanded={true}
				message={{
					ts: 11,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({
						tool: "summarizeTask",
						content: "",
						compactionStatus: "failed",
						error: "The summary exceeded the request output limit.",
					}),
				}}
			/>,
		)

		expect(screen.getByText("Conversation compaction failed:")).toBeInTheDocument()
		expect(screen.getByText("The summary exceeded the request output limit.")).toBeInTheDocument()
		expect(screen.queryByText("Dline is condensing the conversation:")).not.toBeInTheDocument()
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

	it("requests one collapse when an expanded summary stops being the latest message", () => {
		const onToggleExpand = vi.fn()
		const message = {
			ts: 2,
			type: "say" as const,
			say: "tool" as const,
			partial: false,
			text: JSON.stringify({ tool: "summarizeTask", content: "summary" }),
		}
		const rendered = render(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={true} message={message} onToggleExpand={onToggleExpand} />,
		)

		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={false} message={message} onToggleExpand={onToggleExpand} />,
		)

		expect(onToggleExpand).toHaveBeenCalledOnce()
	})

	it("does not auto-collapse a summary again after the user manually reopens it", () => {
		const onToggleExpand = vi.fn()
		const message = {
			ts: 3,
			type: "say" as const,
			say: "tool" as const,
			partial: false,
			text: JSON.stringify({ tool: "summarizeTask", content: "summary" }),
		}
		const rendered = render(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={true} message={message} onToggleExpand={onToggleExpand} />,
		)

		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={false} message={message} onToggleExpand={onToggleExpand} />,
		)
		expect(onToggleExpand).toHaveBeenCalledOnce()

		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={false} isLast={false} message={message} onToggleExpand={onToggleExpand} />,
		)
		fireEvent.click(screen.getByLabelText("Expand summary"))
		expect(onToggleExpand).toHaveBeenCalledTimes(2)

		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={true} message={message} onToggleExpand={onToggleExpand} />,
		)
		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={false} message={message} onToggleExpand={onToggleExpand} />,
		)

		expect(onToggleExpand).toHaveBeenCalledTimes(2)
	})

	it("requests one collapse when an expanded focus change stops being the latest message", () => {
		const onToggleExpand = vi.fn()
		const message = {
			ts: 4,
			type: "ask" as const,
			ask: "focus_chain_change" as const,
			text: JSON.stringify({ plan: "- [ ] Keep the API boundary", reason: "Changed focus" }),
		}
		const rendered = render(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={true} message={message} onToggleExpand={onToggleExpand} />,
		)

		rendered.rerender(
			<ChatRowContent {...baseProps} isExpanded={true} isLast={false} message={message} onToggleExpand={onToggleExpand} />,
		)

		expect(onToggleExpand).toHaveBeenCalledOnce()
	})
})
