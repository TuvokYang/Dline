import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AboutSection from "../sections/AboutSection"
import GeneralSettingsSection from "../sections/GeneralSettingsSection"

/**
 * Where the reporting consent lives.
 *
 * The checkbox and the diagnostic bundle export describe the same decision:
 * what Dline is allowed to record about a session. Splitting them across two
 * settings tabs meant a user who wanted to attach a bundle to a bug report had
 * to find the switch somewhere else first. These tests pin the placement so a
 * later edit cannot silently move the consent back out of About.
 */

const mocks = vi.hoisted(() => ({
	updateSetting: vi.fn(),
	state: { telemetrySetting: "unset" as string, remoteConfigSettings: undefined as unknown },
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: mocks.updateSetting,
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { exportRuntimeTelemetryBundle: vi.fn() },
}))

const renderSectionHeader = (tabId: string) => <div>{tabId}</div>

describe("reporting consent placement", () => {
	beforeEach(() => {
		mocks.updateSetting.mockClear()
		mocks.state.telemetrySetting = "unset"
		mocks.state.remoteConfigSettings = undefined
	})

	it("offers the reporting consent next to the diagnostics export", () => {
		render(<AboutSection renderSectionHeader={renderSectionHeader} version="1.2.3" />)

		expect(screen.getByTestId("telemetry-setting-checkbox")).toBeTruthy()
		expect(screen.getByText("Export diagnostic bundle")).toBeTruthy()
	})

	it("persists the choice through the shared settings path", () => {
		render(<AboutSection renderSectionHeader={renderSectionHeader} version="1.2.3" />)

		const checkbox = screen.getByTestId("telemetry-setting-checkbox")
		fireEvent.click(checkbox)

		expect(mocks.updateSetting).toHaveBeenCalledWith("telemetrySetting", expect.stringMatching(/^(enabled|disabled)$/))
	})

	it("locks the consent when an organization pins it off", () => {
		const { unmount } = render(<AboutSection renderSectionHeader={renderSectionHeader} version="1.2.3" />)
		// The unlocked render is the control: without it, a checkbox that is
		// never disabled would still satisfy the assertion below.
		expect((screen.getByTestId("telemetry-setting-checkbox") as HTMLInputElement).disabled).toBe(false)
		unmount()

		mocks.state.telemetrySetting = "disabled"
		mocks.state.remoteConfigSettings = { telemetrySetting: "disabled" }
		render(<AboutSection renderSectionHeader={renderSectionHeader} version="1.2.3" />)

		expect((screen.getByTestId("telemetry-setting-checkbox") as HTMLInputElement).disabled).toBe(true)
	})

	it("no longer duplicates the consent in general settings", () => {
		render(<GeneralSettingsSection renderSectionHeader={renderSectionHeader} />)

		expect(screen.queryByTestId("telemetry-setting-checkbox")).toBeNull()
	})
})
