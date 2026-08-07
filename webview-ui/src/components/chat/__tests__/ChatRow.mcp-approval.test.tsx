import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

void React

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { actions: { useMcp: true } },
		backgroundEditEnabled: true,
		mcpServers: [
			{
				name: "docs",
				config: "{}",
				status: "connected",
				tools: [{ name: "search", description: "Search docs", autoApprove: true }],
			},
		],
		mcpMarketplaceCatalog: { items: [] },
		onRelinquishControl: () => () => undefined,
		vscodeTerminalExecutionMode: "backgroundExec",
		clineMessages: [],
		showFeatureTips: false,
		taskViewState: undefined,
		currentTaskItem: { id: "task-1" },
	}),
}))

const baseProps = {
	isExpanded: false,
	isLast: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

describe("ChatRow MCP tool rendering", () => {
	it("shows invocation details without Configure auto-approval controls", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 1,
					type: "say",
					say: "use_mcp_server",
					text: JSON.stringify({
						type: "use_mcp_tool",
						serverName: "docs",
						toolName: "search",
						arguments: '{"query":"Dline"}',
					}),
				}}
			/>,
		)

		expect(screen.getByText("search")).toBeInTheDocument()
		expect(screen.getByText("Search docs")).toBeInTheDocument()
		expect(screen.queryByText("Auto-approve")).not.toBeInTheDocument()
	})
})
