import type { ModeSwitchSnapshot } from "@shared/mode-switch"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ModeSwitchDialog } from "./ModeSwitchDialog"

/** Build an awaiting-confirmation snapshot for dialog tests. */
function createSnapshot(): ModeSwitchSnapshot {
	return {
		phase: "awaiting_confirmation",
		operationId: "operation-1",
		taskId: "task-1",
		sourceMode: "plan",
		targetMode: "act",
		sourceProfile: "large-profile",
		targetProfile: "small-profile",
		sourceContextWindow: 200_000,
		targetContextWindow: 100_000,
		currentTokens: 92_000,
		triggerTokens: 90_000,
	}
}

/** Verify the mode-switch warning exposes only safe transaction actions. */
describe("ModeSwitchDialog", () => {
	/** Render complete pressure details and only Cancel/Compact actions. */
	it("renders smaller-window warning details and safe actions", () => {
		const onCancel = vi.fn()
		const onConfirm = vi.fn()

		render(<ModeSwitchDialog onCancel={onCancel} onConfirm={onConfirm} state={createSnapshot()} />)

		expect(screen.getByRole("dialog")).toBeInTheDocument()
		expect(screen.getByText(/smaller context window/i)).toBeInTheDocument()
		expect(screen.getByText(/large-profile/)).toBeInTheDocument()
		expect(screen.getByText(/small-profile/)).toBeInTheDocument()
		expect(screen.getByText(/200,000/)).toBeInTheDocument()
		expect(screen.getByText(/100,000/)).toBeInTheDocument()
		expect(screen.getByText(/92,000/)).toBeInTheDocument()
		expect(screen.getByText(/90,000/)).toBeInTheDocument()
		expect(document.querySelectorAll("vscode-button")).toHaveLength(2)
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		expect(screen.getByText("Compact & Switch")).toBeInTheDocument()
		expect(screen.queryByText(/Switch Anyway/i)).not.toBeInTheDocument()
	})

	/** Route backdrop closure to cancellation, never confirmation. */
	it("cancels when the backdrop closes", () => {
		const onCancel = vi.fn()
		const onConfirm = vi.fn()

		render(<ModeSwitchDialog onCancel={onCancel} onConfirm={onConfirm} state={createSnapshot()} />)
		const backdrop = screen.getByRole("dialog").parentElement
		if (!backdrop) throw new Error("Mode switch backdrop missing.")
		fireEvent.click(backdrop)

		expect(onCancel).toHaveBeenCalledWith("operation-1")
		expect(onConfirm).not.toHaveBeenCalled()
	})

	/** Do not render a dialog outside the confirmation phase. */
	it("stays hidden without an active confirmation operation", () => {
		const state: ModeSwitchSnapshot = { phase: "compacting", operationId: "operation-1" }
		render(<ModeSwitchDialog onCancel={vi.fn()} onConfirm={vi.fn()} state={state} />)
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})
})
