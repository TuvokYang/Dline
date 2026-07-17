/**
 * UserMessage – IME composition Enter test
 * --------------------------------------------------
 * Confirm that sendMessageFromChatRow is not called
 * even if you confirm the IME conversion (Enter) in message re-edit mode.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const mockedContext = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock("@/context/ExtensionStateContext", () => ({
	__esModule: true,
	useExtensionState: () => mockedContext.value,
}))

import { UsageBar } from "../UsageBar"
import UserMessage from "../UserMessage"

describe("UserMessage – IME composition handling", () => {
	it("does NOT send when IME composition Enter is pressed while editing", () => {
		const sendMessageFromChatRow = vi.fn()

		const { getByText } = render(
			<UserMessage images={[]} messageTs={Date.now()} sendMessageFromChatRow={sendMessageFromChatRow} text="変換テスト" />,
		)

		const editable = getByText("変換テスト") as HTMLElement
		editable.setAttribute("contenteditable", "true")
		editable.focus()

		fireEvent.compositionStart(editable)
		fireEvent.keyDown(editable, {
			key: "Enter",
			keyCode: 13,
			nativeEvent: { isComposing: true },
		})
		fireEvent.compositionEnd(editable)

		expect(sendMessageFromChatRow).not.toHaveBeenCalled()
	})
})

describe("UsageBar", () => {
	it("shows Codex short-window and weekly usage", () => {
		mockedContext.value = {
			accountUsage: {
				currency: "",
				quotas: [
					{ type: "5hour", label: "5h", used: 25, limit: 100 },
					{ type: "weekly", label: "Weekly", used: 60, limit: 100 },
				],
			},
		}

		render(<UsageBar />)

		expect(screen.getAllByText(/5h 75% left/).length).toBeGreaterThan(0)
		expect(screen.getAllByText(/Weekly 40% left/).length).toBeGreaterThan(0)
	})

	it("shows an empty value when the active profile has no usage", () => {
		mockedContext.value = {}
		render(<UsageBar />)
		expect(screen.getByText("--")).toBeInTheDocument()
	})
})
