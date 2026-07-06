import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ActionButtons } from "./ActionButtons"

function makeMsg(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return {
		ts: Date.now(),
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "readFile", path: "/test" }),
		...overrides,
	}
}

const mockChatState = {
	inputValue: "",
	selectedImages: [],
	selectedFiles: [],
	sendingDisabled: false,
	enableButtons: false,
	setInputValue: () => {},
	setSelectedImages: () => {},
	setSelectedFiles: () => {},
	setSendingDisabled: () => {},
	setEnableButtons: () => {},
	expandedRows: {},
	setExpandedRows: () => {},
	textAreaRef: { current: null },
} as any

const mockMessageHandlers = {
	executeButtonAction: () => Promise.resolve(),
} as any

describe("ActionButtons", () => {
	it("shows approve button when final tool ask is visible even if raw messages had stale partial", () => {
		const finalMessage = makeMsg({
			ts: 1000,
			partial: false,
			text: JSON.stringify({ tool: "readFile", path: "/test", content: "hello" }),
		})

		const visibleMessages = [finalMessage]

		render(
			<ActionButtons
				chatState={mockChatState}
				messageHandlers={mockMessageHandlers}
				messages={visibleMessages}
				mode="act"
				task={finalMessage}
			/>,
		)

		// The approve button should be visible since final ask is non-partial tool approval
		expect(screen.queryByText(/Approve|approve|Yes|yes/i)).not.toBeNull()
	})

	it("shows cancel when partial ask is the visible message (streaming)", () => {
		const partialMsg = makeMsg({
			ts: 1000,
			partial: true,
		})

		render(
			<ActionButtons
				chatState={mockChatState}
				messageHandlers={mockMessageHandlers}
				messages={[partialMsg]}
				mode="act"
				task={partialMsg}
			/>,
		)

		// Cancel should be shown for streaming partial ask
		expect(screen.queryByText(/Cancel|cancel/i)).not.toBeNull()
	})

	it("keeps buttons interactive when lastMessage changes to same-type ask (consecutive approvals)", () => {
		// Simulate two consecutive tool asks of the same type arriving one after another.
		// The buttonConfig reference stays identical (same BUTTON_CONFIGS.tool_approve),
		// but isProcessing must reset so the second ask's buttons are not stuck disabled.
		const firstMsg = makeMsg({
			ts: 1000,
			partial: false,
			text: JSON.stringify({ tool: "readFile", path: "/a" }),
		})
		const secondMsg = makeMsg({
			ts: 2000,
			partial: false,
			text: JSON.stringify({ tool: "readFile", path: "/b" }),
		})

		// Render with first message
		const { rerender } = render(
			<ActionButtons
				chatState={mockChatState}
				messageHandlers={mockMessageHandlers}
				messages={[firstMsg]}
				mode="act"
				task={firstMsg}
			/>,
		)

		// Buttons should be visible and enabled for the first ask
		const approveBtn = screen.getByText("Approve")
		expect(approveBtn).toBeTruthy()
		expect((approveBtn as HTMLButtonElement).disabled).toBe(false)

		// Now simulate the arrival of a second same-type tool ask (lastMessage changes)
		rerender(
			<ActionButtons
				chatState={mockChatState}
				messageHandlers={mockMessageHandlers}
				messages={[firstMsg, secondMsg]}
				mode="act"
				task={secondMsg}
			/>,
		)

		// Buttons must still be enabled — isProcessing must have been reset by the
		// lastMessage change, even though buttonConfig is the same reference.
		const approveBtnAfter = screen.getByText("Approve")
		expect(approveBtnAfter).toBeTruthy()
		expect((approveBtnAfter as HTMLButtonElement).disabled).toBe(false)
	})

	describe("with taskUiState (snapshot-first architecture)", () => {
		it("renders buttons from taskUiState.actions", () => {
			const mockChatStateWithTaskUi = {
				...mockChatState,
				taskUiState: {
					phase: "awaiting_approval" as const,
					inputEnabled: false,
					cancelEnabled: true,
					showFooter: true,
					actions: [
						{ type: "approve" as const, label: "Approve", enabled: true },
						{ type: "reject" as const, label: "Reject", enabled: true },
					],
					reason: "tool approval required",
				},
			}

			const finalMessage = makeMsg({
				ts: 1000,
				partial: false,
			})

			render(
				<ActionButtons
					chatState={mockChatStateWithTaskUi}
					messageHandlers={mockMessageHandlers}
					messages={[finalMessage]}
					mode="act"
					task={finalMessage}
				/>,
			)

			expect(screen.getByText("Approve")).toBeTruthy()
			expect(screen.getByText("Reject")).toBeTruthy()
		})

		it("renders 3 buttons when provided", () => {
			const mockChatStateWithMultiActions = {
				...mockChatState,
				taskUiState: {
					phase: "awaiting_error_recovery" as const,
					inputEnabled: false,
					cancelEnabled: false,
					showFooter: true,
					actions: [
						{ type: "retry" as const, label: "Retry", enabled: true },
						{ type: "process_anyway" as const, label: "Process Anyway", enabled: true },
						{ type: "start_new_task" as const, label: "Start New", enabled: true },
					],
					reason: "error recovery",
				},
			}

			const finalMessage = makeMsg({
				ts: 1000,
				partial: false,
			})

			render(
				<ActionButtons
					chatState={mockChatStateWithMultiActions}
					messageHandlers={mockMessageHandlers}
					messages={[finalMessage]}
					mode="act"
					task={finalMessage}
				/>,
			)

			expect(screen.getByText("Retry")).toBeTruthy()
			expect(screen.getByText("Process Anyway")).toBeTruthy()
			expect(screen.getByText("Start New")).toBeTruthy()
		})

		it("respects action.enabled flag", () => {
			const mockChatStateWithDisabled = {
				...mockChatState,
				taskUiState: {
					phase: "awaiting_approval" as const,
					inputEnabled: false,
					cancelEnabled: false,
					showFooter: true,
					actions: [{ type: "approve" as const, label: "Approve", enabled: false }],
					reason: "disabled for testing",
				},
			}

			const finalMessage = makeMsg({
				ts: 1000,
				partial: false,
			})

			render(
				<ActionButtons
					chatState={mockChatStateWithDisabled}
					messageHandlers={mockMessageHandlers}
					messages={[finalMessage]}
					mode="act"
					task={finalMessage}
				/>,
			)

			const approveBtn = screen.getByText("Approve") as HTMLButtonElement
			expect(approveBtn.disabled).toBe(true)
		})

		it("truncates to max 3 buttons when more are provided", () => {
			const mockChatStateWithManyActions = {
				...mockChatState,
				taskUiState: {
					phase: "awaiting_approval" as const,
					inputEnabled: false,
					cancelEnabled: false,
					showFooter: true,
					actions: [
						{ type: "approve" as const, label: "Button 1", enabled: true },
						{ type: "reject" as const, label: "Button 2", enabled: true },
						{ type: "cancel" as const, label: "Button 3", enabled: true },
						{ type: "retry" as const, label: "Button 4", enabled: true },
						{ type: "resume" as const, label: "Button 5", enabled: true },
					],
					reason: "truncation test",
				},
			}

			const finalMessage = makeMsg({
				ts: 1000,
				partial: false,
			})

			render(
				<ActionButtons
					chatState={mockChatStateWithManyActions}
					messageHandlers={mockMessageHandlers}
					messages={[finalMessage]}
					mode="act"
					task={finalMessage}
				/>,
			)

			// Only first 3 buttons should be visible
			expect(screen.getByText("Button 1")).toBeTruthy()
			expect(screen.getByText("Button 2")).toBeTruthy()
			expect(screen.getByText("Button 3")).toBeTruthy()
			expect(screen.queryByText("Button 4")).toBeNull()
			expect(screen.queryByText("Button 5")).toBeNull()
		})
	})
})
