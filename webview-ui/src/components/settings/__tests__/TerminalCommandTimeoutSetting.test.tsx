import { fireEvent, render, screen } from "@testing-library/react"
import type { InputHTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TerminalCommandTimeoutSetting from "../TerminalCommandTimeoutSetting"

const mocks = vi.hoisted(() => ({
	updateSetting: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ terminalCommandTimeoutSeconds: 1800 }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: mocks.updateSetting,
}))

describe("TerminalCommandTimeoutSetting", () => {
	beforeEach(() => {
		mocks.updateSetting.mockClear()
	})

	it("shows minutes and persists the backend value in seconds", () => {
		render(<TerminalCommandTimeoutSetting />)
		const input = screen.getByLabelText("Terminal command timeout (minutes)") as HTMLInputElement

		expect(input.value).toBe("30")
		fireEvent.change(input, { target: { value: "45" } })

		expect(mocks.updateSetting).toHaveBeenCalledWith("terminalCommandTimeoutSeconds", 2700)
	})

	it("does not persist values below one minute", () => {
		render(<TerminalCommandTimeoutSetting />)
		const input = screen.getByLabelText("Terminal command timeout (minutes)")

		fireEvent.change(input, { target: { value: "0.5" } })

		expect(mocks.updateSetting).not.toHaveBeenCalled()
		expect(screen.getByText("Enter at least 1 minute")).toBeInTheDocument()
	})
})
