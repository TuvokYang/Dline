import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileServiceClient } from "@/services/grpc-client"
import { CommandOutputRow } from "../CommandOutputRow"

void React

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFile: vi.fn(async () => ({})),
	},
}))

const baseProps = {
	message: { ts: 1, type: "say" as const, say: "command" as const, text: "sleep 10" },
	isCommandExecuting: true,
	isOutputFullyExpanded: false,
	setIsOutputFullyExpanded: vi.fn(),
	onToggleCollapsed: vi.fn(),
}

describe("CommandOutputRow cancellation", () => {
	beforeEach(() => {
		vi.mocked(FileServiceClient.openFile).mockClear()
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn(async () => undefined) },
		})
	})

	it("copies only the executable command from the top-right action", async () => {
		render(
			<CommandOutputRow
				{...baseProps}
				isCollapsed={false}
				message={{
					...baseProps.message,
					text: `echo ready${COMMAND_REQ_APP_STRING}\n${COMMAND_OUTPUT_STRING}\nready`,
				}}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy command" }))

		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("echo ready"))
	})

	it("keeps command copy available when the row is collapsed", () => {
		render(<CommandOutputRow {...baseProps} isCollapsed={true} />)

		expect(screen.getByRole("button", { name: "Copy command" })).toBeVisible()
	})
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

	it("shows Failed instead of Skipped for a failed command", () => {
		render(<CommandOutputRow {...baseProps} isCollapsed={false} isCommandExecuting={false} isCommandFailed={true} />)

		expect(screen.getByText("Failed")).toBeInTheDocument()
		expect(screen.queryByText("Skipped")).not.toBeInTheDocument()
	})

	it("prefers the structured log path when opening command output", () => {
		const structuredPath = "C:\\Temp\\structured.log"
		const legacyPath = "C:\\Temp\\legacy.log"
		render(
			<CommandOutputRow
				{...baseProps}
				isCollapsed={false}
				message={{
					...baseProps.message,
					logPath: structuredPath,
					text: `serve${COMMAND_OUTPUT_STRING}⏱️ Command timed out. Output is being logged to: ${legacyPath}`,
				}}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Open log file structured.log" }))
		expect(FileServiceClient.openFile).toHaveBeenCalledWith(expect.objectContaining({ value: structuredPath }))
	})

	it("opens a timeout log path from legacy command output", () => {
		const legacyPath = "C:\\Temp\\timeout.log"
		render(
			<CommandOutputRow
				{...baseProps}
				isCollapsed={false}
				message={{
					...baseProps.message,
					text: `serve${COMMAND_OUTPUT_STRING}⏱️ Command timed out. Output is being logged to: ${legacyPath}`,
				}}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Open log file timeout.log" }))
		expect(FileServiceClient.openFile).toHaveBeenCalledWith(expect.objectContaining({ value: legacyPath }))
	})
})
