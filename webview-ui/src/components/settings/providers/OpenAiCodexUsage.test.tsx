import type { AccountUsageData } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAiCodexUsage } from "./OpenAiCodexUsage"
import { providerUsageProgressTone, selectEffectiveUsageQuota } from "./ProviderUsageDetails"

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	consumeResetCredit: vi.fn(),
	useUsage: vi.fn(),
}))

vi.mock("./useProviderUsage", () => ({
	useProviderUsage: mocks.useUsage,
}))

const usage: AccountUsageData = {
	profileId: "profile-a",
	providerId: "openai-codex",
	currency: "",
	planType: "pro",
	quotas: [
		{ type: "5hour", label: "5 hour", used: 50, limit: 100, windowSeconds: 18_000 },
		{ type: "weekly", label: "7 day", used: 80, limit: 100, windowSeconds: 604_800 },
	],
	resetCreditsAvailableCount: 1,
	resetCredits: [{ id: "credit-a", expiresAt: "2030-03-25T00:00:00.000Z" }],
	allowed: true,
	limitReached: false,
	isAvailable: true,
}

describe("ProviderUsage through OpenAiCodexUsage compatibility", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.refresh.mockResolvedValue(usage)
		mocks.consumeResetCredit.mockResolvedValue({
			profileId: "profile-a",
			outcome: "reset",
			quotaTypesReset: ["primary", "secondary"],
			usage: undefined,
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
		expect(selectEffectiveUsageQuota(usage.quotas ?? [])?.type).toBe("weekly")
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

	it("uses semantic color only inside progress details", () => {
		expect(providerUsageProgressTone(79.99)).toBe("success")
		expect(providerUsageProgressTone(80)).toBe("warning")
		expect(providerUsageProgressTone(99)).toBe("warning")
		expect(providerUsageProgressTone(100)).toBe("danger")
	})
})
