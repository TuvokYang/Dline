import type { OpenAiCodexRateLimitResetOutcome, OpenAiCodexUsageResponse } from "@shared/proto/dline/account"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { codexUsageProgressTone, OpenAiCodexUsage, selectEffectiveCodexUsageWindow } from "./OpenAiCodexUsage"

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	consumeResetCredit: vi.fn(),
	useUsage: vi.fn(),
}))

vi.mock("@shared/proto/dline/account", () => ({}))

vi.mock("./useOpenAiCodexUsage", () => ({
	useOpenAiCodexUsage: mocks.useUsage,
}))

const usage: OpenAiCodexUsageResponse = {
	profileId: "profile-a",
	planType: "pro",
	windows: [
		{
			type: "5hour",
			label: "5 hour",
			usedPercent: 50,
			remainingPercent: 50,
			limitWindowSeconds: 18_000,
			resetAtMs: 1_900_000_000_000,
		},
		{
			type: "weekly",
			label: "7 day",
			usedPercent: 80,
			remainingPercent: 20,
			limitWindowSeconds: 604_800,
			resetAtMs: 1_900_500_000_000,
		},
	],
	creditsBalance: undefined,
	resetCreditsAvailableCount: 1,
	resetCredits: [{ id: "credit-a", expiresAtMs: 1_900_750_000_000 }],
	allowed: true,
	limitReached: false,
	isAvailable: true,
}

describe("OpenAiCodexUsage", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.refresh.mockResolvedValue(usage)
		mocks.consumeResetCredit.mockResolvedValue({
			profileId: "profile-a",
			outcome: 1 as OpenAiCodexRateLimitResetOutcome,
			windowsReset: ["primary", "secondary"],
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

	it("uses the tighter quota as the compact summary and expands both windows", () => {
		expect(selectEffectiveCodexUsageWindow(usage.windows)?.type).toBe("weekly")
		render(<OpenAiCodexUsage enabled profileId="profile-a" />)

		const summary = screen.getByRole("button", { name: "Usage 7 day 20%" })
		expect(summary).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(summary)

		expect(summary).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText("5 hour")).toBeInTheDocument()
		expect(screen.getAllByText("7 day").length).toBeGreaterThan(0)
		expect(screen.getByText("50% remaining")).toBeInTheDocument()
		expect(screen.getByText("20% remaining")).toBeInTheDocument()
		expect(screen.getByText("Reset cards: 1")).toBeInTheDocument()
	})

	it("requires confirmation before consuming a reset card", async () => {
		render(<OpenAiCodexUsage enabled profileId="profile-a" />)
		fireEvent.click(screen.getByRole("button", { name: "Usage 7 day 20%" }))
		fireEvent.click(screen.getByRole("button", { name: "Use reset card 1" }))

		expect(mocks.consumeResetCredit).not.toHaveBeenCalled()
		expect(screen.getByRole("dialog", { name: "Use a rate-limit reset card?" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Use reset card" }))

		await waitFor(() => expect(mocks.consumeResetCredit).toHaveBeenCalledWith("credit-a"))
		expect(await screen.findByText("Reset completed for primary and secondary.")).toBeInTheDocument()
	})

	it("uses green below 80%, orange from 80% through 99%, and red at 100%", () => {
		expect(codexUsageProgressTone(79.99)).toBe("success")
		expect(codexUsageProgressTone(80)).toBe("warning")
		expect(codexUsageProgressTone(99)).toBe("warning")
		expect(codexUsageProgressTone(100)).toBe("danger")
	})
})
