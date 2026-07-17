import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { CommandOutputRow } from "../CommandOutputRow"

void React

const baseProps = {
	message: { ts: 1, type: "say" as const, say: "command" as const, text: "sleep 10" },
	isCommandExecuting: true,
	isOutputFullyExpanded: false,
	setIsOutputFullyExpanded: vi.fn(),
	onToggleCollapsed: vi.fn(),
}

describe("CommandOutputRow cancellation", () => {
	it("shows Cancel for a running VS Code terminal command", () => {
		const onCancelCommand = vi.fn()
		render(<CommandOutputRow {...baseProps} isBackgroundExec={false} isCollapsed={false} onCancelCommand={onCancelCommand} />)

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onCancelCommand).toHaveBeenCalledOnce()
	})

	it("keeps Cancel visible when the running command row is collapsed", () => {
		const onCancelCommand = vi.fn()
		render(<CommandOutputRow {...baseProps} isBackgroundExec={false} isCollapsed={true} onCancelCommand={onCancelCommand} />)

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onCancelCommand).toHaveBeenCalledOnce()
	})
})
