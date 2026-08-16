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
	it("states that compaction runs with the target Profile and shows the strict fitting exit", () => {
		render(
			<ContextTransitionDialog
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
				onRetry={vi.fn()}
				state={awaitingState()}
			/>,
		)

		expect(screen.getByText(/Compaction will run with small-profile/i)).toBeInTheDocument()
		expect(screen.getByText("80,000 tokens")).toBeInTheDocument()
		expect(screen.getByText("Compact & Switch")).toBeInTheDocument()
	})

	it("reports a terminal failure, preserves the source, and offers retry or dismiss", () => {
		const onRetry = vi.fn()
		render(
			<ContextTransitionDialog
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
				onRetry={onRetry}
				state={{
					...awaitingState(),
					phase: "failed",
					error: "Compaction failed.",
				}}
			/>,
		)

		expect(screen.getByText("Switch not completed")).toBeInTheDocument()
		expect(screen.getByText(/large-profile remains active/i)).toBeInTheDocument()
		expect(screen.getByText("Compaction failed.")).toBeInTheDocument()
		fireEvent.click(screen.getByText("Retry"))
		expect(onRetry).toHaveBeenCalledWith("operation-1")
		fireEvent.click(screen.getByText("Dismiss"))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})
})
