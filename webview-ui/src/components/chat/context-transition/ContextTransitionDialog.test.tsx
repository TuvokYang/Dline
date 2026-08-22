import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContextTransitionDialog, type ContextTransitionDialogState } from "./ContextTransitionDialog"

function awaitingState(): ContextTransitionDialogState {
	return {
		kind: "profile",
		phase: "awaiting_confirmation",
		operationId: "operation-1",
		sourceLabel: "large-profile",
		targetLabel: "small-profile",
		currentTokens: 92_000,
		targetContextWindow: 100_000,
		fittingExitTarget: 80_000,
	}
}

describe("ContextTransitionDialog", () => {
	it("states that the target Profile is activated before compaction and shows the strict fitting exit", () => {
		render(<ContextTransitionDialog onCancel={vi.fn()} onConfirm={vi.fn()} onRetry={vi.fn()} state={awaitingState()} />)

		expect(screen.getByText(/small-profile will be activated first/i)).toBeInTheDocument()
		expect(screen.getByText("80,000 tokens")).toBeInTheDocument()
		expect(screen.getByText("Compact & Switch")).toBeInTheDocument()
	})

	it("reports a Profile compaction failure while keeping the adopted target active", () => {
		const onRetry = vi.fn()
		render(
			<ContextTransitionDialog
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
				onRetry={onRetry}
				state={{
					...awaitingState(),
					phase: "failed",
					targetAdopted: true,
					error: "Compaction failed.",
				}}
			/>,
		)

		expect(screen.getByText("Context compaction not completed")).toBeInTheDocument()
		expect(screen.getByText(/small-profile remains active/i)).toBeInTheDocument()
		expect(screen.getByText("Compaction failed.")).toBeInTheDocument()
		fireEvent.click(screen.getByText("Retry"))
		expect(onRetry).toHaveBeenCalledWith("operation-1")
		fireEvent.click(screen.getByText("Dismiss"))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("reports a failed Profile adoption without claiming that the target remains active", () => {
		render(
			<ContextTransitionDialog
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
				onRetry={vi.fn()}
				state={{ ...awaitingState(), phase: "failed", targetAdopted: false, error: "Profile adoption failed." }}
			/>,
		)

		expect(screen.getByText("Switch not completed")).toBeInTheDocument()
		expect(screen.getByText(/large-profile remains active/i)).toBeInTheDocument()
		expect(screen.getByText("Profile adoption failed.")).toBeInTheDocument()
	})
})
