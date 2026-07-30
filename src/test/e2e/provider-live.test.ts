import { expect } from "@playwright/test"
import { type E2EProfileTarget, hasLiveProfileCredentials } from "./utils/api-profile"
import { e2e } from "./utils/helpers"

const requestedProfile = process.env.DLINE_E2E_PROFILE as E2EProfileTarget | undefined
const liveProfiles = new Set<E2EProfileTarget>(["deepseek", "openai-codex", "openai-compatible"])
const canRun = Boolean(requestedProfile && liveProfiles.has(requestedProfile) && hasLiveProfileCredentials(requestedProfile))

e2e.describe("Live provider profile", () => {
	e2e.skip(!canRun, "No requested live-provider credentials are available")

	e2e(`completes a minimal turn with ${requestedProfile}`, async ({ helper, sidebar }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("Calculate 271828 + 314159. Return only the numeric result, without separators or explanation.")
		await sidebar.getByTestId("send-button").click()

		await expect(sidebar.getByText("585987", { exact: false }).last()).toBeVisible({ timeout: 120_000 })
	})
})
