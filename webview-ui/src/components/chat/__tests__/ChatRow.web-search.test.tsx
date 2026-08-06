import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

void React

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
	isExpanded: false,
	isLast: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

describe("ChatRow hosted Web Search rendering", () => {
	it("does not render a duplicate external icon on the Web Search card", () => {
		const { container } = render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({
						tool: "webSearch",
						path: "Dline web search",
						content: "Searching for: Dline web search",
						operationIsLocatedInWorkspace: false,
						webSearch: {
							source: {
								engineId: "deepseek-hosted",
								label: "DeepSeek Web Search",
								execution: "hosted",
								provider: "deepseek",
							},
							result: {
								items: [
									{
										title: "Dline result",
										url: "https://example.com/dline",
										snippet: "Provider-compressed search result",
									},
								],
							},
						},
					}),
				}}
			/>,
		)

		expect(container.querySelector(".codicon-sign-out")).toBeNull()
	})

	it("renders the actual source and provider-compressed results", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({
						tool: "webSearch",
						path: "Dline web search",
						content: "Searching for: Dline web search",
						operationIsLocatedInWorkspace: false,
						webSearch: {
							source: {
								engineId: "deepseek-hosted",
								label: "DeepSeek Web Search",
								execution: "hosted",
								provider: "deepseek",
							},
							result: {
								items: [
									{
										title: "Dline result",
										url: "https://example.com/dline",
										snippet: "Provider-compressed search result",
									},
								],
							},
						},
					}),
				}}
			/>,
		)

		expect(screen.getByText("DeepSeek Web Search (Hosted)")).toBeInTheDocument()
		expect(screen.getByText("Dline result")).toBeInTheDocument()
		expect(screen.getByText("https://example.com/dline")).toBeInTheDocument()
		expect(screen.getByText("Provider-compressed search result")).toBeInTheDocument()
	})

	it("renders the selected Dline engine and actionable error", () => {
		render(
			<ChatRowContent
				{...baseProps}
				message={{
					ts: 2,
					type: "say",
					say: "tool",
					partial: false,
					text: JSON.stringify({
						tool: "webSearch",
						path: "Dline timeout",
						webSearch: {
							source: { engineId: "bing", label: "Browser / Bing", execution: "dline" },
							error: "Browser / Bing search failed: navigation timed out",
						},
					}),
				}}
			/>,
		)

		expect(screen.getByText("Browser / Bing (Dline)")).toBeInTheDocument()
		expect(screen.getByText("Browser / Bing search failed: navigation timed out")).toBeInTheDocument()
	})
})
