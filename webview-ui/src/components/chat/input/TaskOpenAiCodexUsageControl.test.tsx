import type { OpenAiCodexRateLimitResetOutcome, OpenAiCodexUsageResponse } from "@shared/proto/dline/account"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskOpenAiCodexUsageControl } from "./TaskOpenAiCodexUsageControl"

class TestResizeObserver implements ResizeObserver {
	disconnect = vi.fn()
	observe = vi.fn()
	unobserve = vi.fn()
}

globalThis.ResizeObserver = TestResizeObserver

const mocks = vi.hoisted(() => ({
	consumeResetCredit: vi.fn(),
	refresh: vi.fn(),
	useUsage: vi.fn(),
}))

vi.mock("@shared/proto/dline/account", () => ({}))
vi.mock("@components/settings/providers/useOpenAiCodexUsage", () => ({
	useOpenAiCodexUsage: mocks.useUsage,
}))

const usage: OpenAiCodexUsageResponse = {
	profileId: "profile-a",
	planType: "plus",
	windows: [
		{
			type: "5hour",
			label: "5 hour",
			usedPercent: 25,
			remainingPercent: 75,
			limitWindowSeconds: 18_000,
			resetAtMs: 1_900_000_000_000,
		},
		{
			type: "weekly",
			label: "7 day",
			usedPercent: 83,
			remainingPercent: 17,
			limitWindowSeconds: 604_800,
			resetAtMs: 1_900_500_000_000,
		},
	],
	resetCreditsAvailableCount: 1,
	resetCredits: [{ id: "credit-a", expiresAtMs: 1_900_750_000_000 }],
	allowed: true,
	limitReached: false,
	isAvailable: true,
}

beforeAll(() => {
	Object.defineProperties(HTMLElement.prototype, {
		hasPointerCapture: { configurable: true, value: () => false },
		releasePointerCapture: { configurable: true, value: () => undefined },
		setPointerCapture: { configurable: true, value: () => undefined },
	})
})

describe("TaskOpenAiCodexUsageControl", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.refresh.mockResolvedValue(usage)
		mocks.consumeResetCredit.mockResolvedValue({
			profileId: "profile-a",
			outcome: 1 as OpenAiCodexRateLimitResetOutcome,
			windowsReset: ["primary"],
		})
		mocks.useUsage.mockReturnValue({
			usage,
			loading: false,
			refreshing: false,
			resetting: false,
			error: undefined,
			resetError: undefined,
			refresh: mocks.refresh,
			consumeResetCredit: mocks.consumeResetCredit,
		})
	})

	it("shows only usage, reset times, card count, and expiry in the tooltip", async () => {
		const user = userEvent.setup()
		render(<TaskOpenAiCodexUsageControl profileId="profile-a" />)

		await user.hover(screen.getByRole("button", { name: "OpenAI Codex usage" }))

		expect((await screen.findAllByText(/5 hour: 25% used/)).length).toBeGreaterThan(0)
		expect(screen.getAllByText(/7 day: 83% used/).length).toBeGreaterThan(0)
		expect(screen.getAllByText("Reset cards: 1").length).toBeGreaterThan(0)
		expect(screen.getAllByText(/Next card expires/).length).toBeGreaterThan(0)
	})

	it("opens a usage panel and confirms the selected reset card", async () => {
		render(<TaskOpenAiCodexUsageControl profileId="profile-a" />)
		fireEvent.click(screen.getByRole("button", { name: "OpenAI Codex usage" }))

		expect(screen.getByLabelText("OpenAI Codex usage details")).toBeInTheDocument()
		expect(screen.getByRole("progressbar", { name: "7 day usage" })).toHaveAttribute("data-usage-tone", "warning")
		fireEvent.click(screen.getByRole("button", { name: "Use reset card 1" }))
		expect(screen.getByRole("dialog", { name: "Use a rate-limit reset card?" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Use reset card" }))

		await waitFor(() => expect(mocks.consumeResetCredit).toHaveBeenCalledWith("credit-a"))
	})
})
