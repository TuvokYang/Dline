import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckpointsServiceClient } from "@/services/grpc-client"
import { CheckmarkControl } from "./CheckmarkControl"

const relinquishListeners = new Set<() => void>()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		onRelinquishControl: (listener: () => void) => {
			relinquishListeners.add(listener)
			return () => relinquishListeners.delete(listener)
		},
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	CheckpointsServiceClient: {
		checkpointDiff: vi.fn(async () => ({})),
		checkpointRestore: vi.fn(async () => ({})),
	},
}))

describe("CheckmarkControl", () => {
	beforeEach(() => {
		relinquishListeners.clear()
		vi.mocked(CheckpointsServiceClient.checkpointDiff).mockClear()
		vi.mocked(CheckpointsServiceClient.checkpointRestore).mockClear()
	})

	it("opens the restore confirmation and restores files and task", async () => {
		render(<CheckmarkControl messageTs={42} />)

		fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true, hidden: true }))
		const restoreAll = screen.getByRole("button", { name: "Restore Files & Task", exact: true })
		expect(restoreAll).toBeVisible()

		fireEvent.click(restoreAll)
		expect(CheckpointsServiceClient.checkpointRestore).toHaveBeenCalledWith(
			expect.objectContaining({ number: 42, restoreType: "taskAndWorkspace" }),
		)
	})

	it("can reopen Restore after Compare relinquishes control", async () => {
		render(<CheckmarkControl messageTs={42} />)

		fireEvent.click(screen.getByRole("button", { name: "Compare", exact: true, hidden: true }))
		for (const listener of relinquishListeners) listener()
		fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true, hidden: true }))

		expect(screen.getByRole("button", { name: "Restore Files & Task", exact: true })).toBeVisible()
	})

	it("keeps the restore confirmation open when the pointer leaves the checkpoint control", () => {
		vi.useFakeTimers()
		try {
			render(<CheckmarkControl messageTs={42} />)
			fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true, hidden: true }))

			const checkpointLabel = screen.getByText("Checkpoint", { exact: true })
			const checkpointControl = checkpointLabel.parentElement?.parentElement
			if (!checkpointControl) throw new Error("Checkpoint control container was not rendered")
			fireEvent.mouseLeave(checkpointControl)
			act(() => vi.advanceTimersByTime(400))

			expect(screen.getByRole("button", { name: "Restore Files & Task", exact: true })).toBeVisible()
		} finally {
			vi.useRealTimers()
		}
	})

	it("closes the restore confirmation on an outside pointer press", () => {
		render(
			<div>
				<button type="button">Outside</button>
				<CheckmarkControl messageTs={42} />
			</div>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true, hidden: true }))

		fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }))

		expect(screen.queryByRole("button", { name: "Restore Files & Task", exact: true })).not.toBeInTheDocument()
	})

	it("closes the restore confirmation on Escape", () => {
		render(<CheckmarkControl messageTs={42} />)
		fireEvent.click(screen.getByRole("button", { name: "Restore", exact: true, hidden: true }))

		fireEvent.keyDown(document, { key: "Escape" })

		expect(screen.queryByRole("button", { name: "Restore Files & Task", exact: true })).not.toBeInTheDocument()
	})
})
