// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import ThinkingControl from "./ThinkingControl"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({
		checked,
		children,
		disabled,
		onChange,
	}: {
		checked?: boolean
		children: ReactNode
		disabled?: boolean
		onChange?: React.ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} disabled={disabled} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

describe("ThinkingControl", () => {
	it("shows a default-enabled model at its configured default effort", () => {
		render(
			<ThinkingControl
				defaultEffort="high"
				defaultEnabled={true}
				effortOptions={["none", "low", "medium", "high", "max"]}
				mode="effort-only"
				onReasoningConfigUpdate={vi.fn()}
			/>,
		)

		expect(screen.getByRole("checkbox", { name: "Enable Thinking" })).toBeChecked()
		expect(screen.getByRole("combobox")).toHaveTextContent("High")
	})

	it("persists an explicit disabled request when None is selected", () => {
		const onReasoningConfigUpdate = vi.fn()
		render(
			<ThinkingControl
				defaultEffort="high"
				defaultEnabled={true}
				effortLabel="Adaptive Thinking"
				effortOptions={["none", "low", "medium", "high", "max"]}
				mode="effort-only"
				onReasoningConfigUpdate={onReasoningConfigUpdate}
			/>,
		)

		fireEvent.click(screen.getByRole("combobox"))
		fireEvent.click(screen.getByRole("option", { name: "None" }))

		expect(onReasoningConfigUpdate).toHaveBeenCalledWith({
			enableThinking: false,
			effort: "none",
			thinkingBudget: undefined,
		})
	})

	it("keeps required thinking enabled when a stale profile requests disabled", () => {
		const onReasoningConfigUpdate = vi.fn()
		render(
			<ThinkingControl
				defaultEffort="high"
				defaultEnabled={true}
				disableSupported={false}
				effortLabel="Adaptive Thinking"
				effortOptions={["low", "medium", "high", "max"]}
				mode="effort-only"
				onReasoningConfigUpdate={onReasoningConfigUpdate}
				reasoningConfig={{ enableThinking: false, effort: "none" }}
			/>,
		)

		const enableThinking = screen.getByRole("checkbox", { name: "Enable Thinking" })
		expect(enableThinking).toBeChecked()
		expect(enableThinking).toBeDisabled()
		expect(screen.getByRole("combobox")).toHaveTextContent("High")
		expect(screen.queryByRole("option", { name: "None" })).not.toBeInTheDocument()
		expect(onReasoningConfigUpdate).not.toHaveBeenCalled()
	})
})
