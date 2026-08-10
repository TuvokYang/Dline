import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	name: string
	openai?: {
		streamIdleTimeoutSeconds?: number
	}
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")

async function readProfiles(dlineDir: string): Promise<StoredProfile[]> {
	return JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
}

async function clearResponsesIdleTimeout(dlineDir: string): Promise<void> {
	const profiles = await readProfiles(dlineDir)
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai) throw new Error("Missing OpenAI Responses E2E profile")
	delete profile.openai.streamIdleTimeoutSeconds
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")
}

async function configureResponsesIdleTimeout(dlineDir: string): Promise<void> {
	const profiles = await readProfiles(dlineDir)
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai) throw new Error("Missing OpenAI Responses E2E profile")
	profile.openai.streamIdleTimeoutSeconds = 1
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settingsPath = path.join(dlineDir, "data", "settings", "settings.json")
	const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>
	settings.actModeProfile = E2E_PROFILE_NAMES.mockOpenAiResponses
	settings.planModeProfile = E2E_PROFILE_NAMES.mockOpenAiResponses
	await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function openSidebar(app: ElectronApplication, helper: E2ETestHelper): Promise<Frame> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return sidebar
}

async function openResponsesProfileEditor(app: ElectronApplication, sidebar: Frame): Promise<Locator> {
	const page = await app.firstWindow()
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
	const card = sidebar
		.getByTestId("api-profile-card")
		.filter({ has: sidebar.locator(`input[value=${JSON.stringify(E2E_PROFILE_NAMES.mockOpenAiResponses)}]`) })
	await expect(card).toHaveCount(1)
	const providerSelector = card.locator('select[aria-label="Provider"]')
	if (!(await providerSelector.isVisible())) await card.getByRole("button").first().press("Enter")
	await expect(providerSelector).toBeVisible()
	return card
}

async function widenWebviewForRateMetrics(sidebar: Frame): Promise<void> {
	await sidebar.evaluate(() => {
		document.documentElement.style.width = "900px"
		document.body.style.width = "900px"
	})
}

e2e(
	"OpenAI Responses stream idle timeout defaults to 120 seconds and persists after reopening VS Code",
	async ({ dlineDir, helper, openVSCode, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await clearResponsesIdleTimeout(dlineDir)
		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined

		try {
			firstApp = await openVSCode(workspaceDir)
			const firstSidebar = await openSidebar(firstApp, helper)
			const firstCard = await openResponsesProfileEditor(firstApp, firstSidebar)
			const firstTimeoutField = firstCard.getByRole("textbox", {
				name: "Responses stream idle timeout (seconds)",
			})
			await expect(firstTimeoutField).toHaveValue("120")
			await firstTimeoutField.fill("45")
			await firstTimeoutField.press("Tab")
			await E2ETestHelper.waitUntil(async () => {
				const profile = (await readProfiles(dlineDir)).find(
					(candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses,
				)
				return profile?.openai?.streamIdleTimeoutSeconds === 45
			})

			await firstApp.close()
			firstApp = undefined
			helper.clearCachedFrame()

			reopenedApp = await openVSCode(workspaceDir)
			const reopenedSidebar = await openSidebar(reopenedApp, helper)
			const reopenedCard = await openResponsesProfileEditor(reopenedApp, reopenedSidebar)
			await expect(reopenedCard.getByRole("textbox", { name: "Responses stream idle timeout (seconds)" })).toHaveValue("45")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)

e2e(
	"OpenAI Responses idle timeout aborts, retries, and exposes TaskHeader RPM/TPM",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureResponsesIdleTimeout(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "message",
				text: "THIS_RESPONSE_MUST_BE_ABORTED",
				reasoning: "E2E_STREAM_IDLE_REASONING",
				afterReasoningDelayMs: 2_500,
				usage: { inputTokens: 1_000, outputTokens: 200, reasoningTokens: 100 },
			},
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_STREAM_IDLE_RETRY_OK" },
				usage: { inputTokens: 1_200, outputTokens: 300, reasoningTokens: 120 },
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await widenWebviewForRateMetrics(sidebar)
			const input = sidebar.getByTestId("chat-input")
			await input.fill("Exercise OpenAI Responses stream idle recovery.")
			await input.press("Enter")

			await expect(sidebar.getByText("E2E_STREAM_IDLE_REASONING", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect(sidebar.getByText("E2E_STREAM_IDLE_RETRY_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect(sidebar.getByText("THIS_RESPONSE_MUST_BE_ABORTED", { exact: false })).toHaveCount(0)

			const consumptions = server.getMockConsumptions("openai-compatible-responses")
			expect(consumptions).toHaveLength(2)
			expect(consumptions[0].abortedAtMs).toBeDefined()
			expect(consumptions[1].contractError).toBeUndefined()

			const rate = sidebar.getByTestId("task-rate-metrics")
			await expect(rate).toBeVisible()
			await expect(rate).toContainText("RPM:2")
			await expect(rate).toContainText(/TPM:[1-9]/)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [
				/OpenAI Responses stream received no event for 1 seconds/,
			])
		} finally {
			await app.close()
		}
	},
)
