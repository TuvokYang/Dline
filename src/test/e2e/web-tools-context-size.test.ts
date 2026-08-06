import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { ApiFormat } from "../../shared/proto/dline/models/metadata"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	name: string
	provider: string
	modelId: string
	baseUrl?: string
	webSearchMode?: string
	openai?: {
		apiFormat?: string
		customModelEnabled?: boolean
		capabilities?: {
			contextWindow?: number
			tools?: string[]
		}
	}
	deepseek?: {
		apiFormat?: string
	}
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function readProfiles(dlineDir: string): Promise<StoredProfile[]> {
	return JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
}

async function readSettings(dlineDir: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
}

async function waitForProfile(
	dlineDir: string,
	name: string,
	predicate: (profile: StoredProfile) => boolean,
): Promise<StoredProfile> {
	return E2ETestHelper.waitForValue(async () => {
		const profile = (await readProfiles(dlineDir)).find((candidate) => candidate.name === name)
		return profile && predicate(profile) ? profile : undefined
	}, 15_000)
}

async function openApiSettings(page: Page, sidebar: Frame): Promise<void> {
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
}

function getProfileCard(sidebar: Frame, profileName: string): Locator {
	return sidebar.getByTestId("api-profile-card").filter({ has: sidebar.locator(`input[value=${JSON.stringify(profileName)}]`) })
}

async function openProfileEditor(sidebar: Frame, profileName: string): Promise<Locator> {
	const card = getProfileCard(sidebar, profileName)
	await expect(card).toHaveCount(1)
	const providerSelector = card.getByRole("combobox", { name: "Provider", exact: true })
	if (!(await providerSelector.isVisible())) await card.getByRole("button").first().press("Enter")
	await expect(providerSelector).toBeVisible()
	return card
}

async function openModelConfiguration(card: Locator): Promise<void> {
	const contextWindow = card.getByRole("textbox", { name: "Context Window Size" })
	if (await contextWindow.isVisible()) return
	await card.getByText("Model Configuration", { exact: true }).click()
	await expect(contextWindow).toBeVisible()
}

async function setTextField(card: Locator, name: string, value: string): Promise<void> {
	const field = card.getByRole("textbox", { name })
	await field.fill(value)
	await field.press("Tab")
	await expect(field).toHaveValue(value)
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

e2e(
	"BUGFIX-001 settings - Web Tools are Agent-owned and Provider routing is configured exactly once",
	async ({ dlineDir, helper, page, sidebar, userDataDir }) => {
		await helper.signin(sidebar)
		await openApiSettings(page, sidebar)

		await sidebar.getByTestId("tab-features").click()
		await expect(sidebar.getByRole("heading", { name: "Feature Settings" })).toBeVisible()
		const agentFeatures = sidebar.locator("#agent-features")
		const editorFeatures = sidebar.locator("#optional-features")
		await expect(agentFeatures.locator('[id="Web Tools"]')).toHaveCount(1)
		await expect(editorFeatures.locator('[id="Web Tools"]')).toHaveCount(0)

		const engineSelector = agentFeatures.getByRole("combobox", { name: "Local Web Search engine" })
		await expect(engineSelector).toHaveValue("duckduckgo")
		await expect(engineSelector.getByRole("option")).toHaveText(["Browser / DuckDuckGo", "Browser / Bing", "SearXNG"])
		await expect(engineSelector.getByRole("option", { name: /Cline/i })).toHaveCount(0)
		await engineSelector.selectOption("searxng")
		const searxngUrl = agentFeatures.getByRole("textbox", { name: "SearXNG URL" })
		await searxngUrl.fill("https://search.example.test")
		await searxngUrl.press("Tab")
		await expect.poll(async () => (await readSettings(dlineDir)).localWebSearchEngine).toBe("searxng")
		await expect.poll(async () => (await readSettings(dlineDir)).searxngSearchUrl).toBe("https://search.example.test")

		await sidebar.getByTestId("tab-api-config").click()
		const openAiCard = await openProfileEditor(sidebar, E2E_PROFILE_NAMES.mockOpenAiOfficialResponses)
		await openModelConfiguration(openAiCard)
		await expect(openAiCard.locator("vscode-checkbox").filter({ hasText: "Supports Web Search" })).toHaveCount(1)
		await expect(openAiCard.getByRole("combobox", { name: "Web Search mode" })).toHaveCount(1)
		await expect(openAiCard.getByText("Hosted Web Search available", { exact: true })).toBeVisible()

		const deepSeekCard = await openProfileEditor(sidebar, E2E_PROFILE_NAMES.mockDeepSeek)
		await expect(deepSeekCard.getByRole("combobox", { name: "API Format" })).toHaveValue(String(ApiFormat.ANTHROPIC_CHAT))
		await expect(deepSeekCard.getByRole("combobox", { name: "Web Search mode" })).toHaveCount(1)
		await expect(deepSeekCard.getByText("Hosted Web Search available", { exact: true })).toBeVisible()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"BUGFIX-001 hosted search - renders Provider source and compressed results without the extra external icon",
	async ({ dlineDir, helper, server, sidebar, userDataDir }) => {
		const profiles = await readProfiles(dlineDir)
		const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiOfficialResponses)
		if (!profile) throw new Error("Official OpenAI E2E profile is missing")
		profile.webSearchMode = "WEB_SEARCH_MODE_AUTO"
		await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")
		const settings = await readSettings(dlineDir)
		settings.actModeProfile = E2E_PROFILE_NAMES.mockOpenAiOfficialResponses
		settings.planModeProfile = E2E_PROFILE_NAMES.mockOpenAiOfficialResponses
		settings.clineWebToolsEnabled = true
		await writeFile(settingsPath(dlineDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8")

		const query = "Dline compressed hosted result"
		const resultTitle = "Provider-compressed Dline result"
		const resultUrl = "https://example.test/provider-compressed-dline"
		const resultSnippet = "Provider-compressed result summary"
		server.enqueueResponses("openai-official-responses", {
			type: "hosted-web-search",
			id: "ws_bugfix_001_hosted",
			query,
			results: [{ title: resultTitle, url: resultUrl, snippet: resultSnippet }],
			followupTools: [
				{ id: "call_bugfix_001_hosted_done", name: "attempt_completion", arguments: { result: "E2E_HOSTED_RESULT_OK" } },
			],
		})

		await helper.signin(sidebar)
		await sendTask(sidebar, "Use provider-hosted Web Search and return the compressed result.")
		const searchCard = sidebar.getByTestId("web-search-card").filter({ hasText: query })
		await expect(searchCard).toBeVisible({ timeout: 60_000 })
		await expect(searchCard).toContainText("OpenAI Web Search (Hosted)")
		await expect(searchCard.getByText(resultTitle, { exact: true })).toBeVisible()
		await expect(searchCard.getByText(resultUrl, { exact: true })).toBeVisible()
		await expect(searchCard.getByText(resultSnippet, { exact: true })).toBeVisible()
		await expect(searchCard.locator(".codicon-sign-out")).toHaveCount(0)
		await expect(sidebar.getByText("E2E_HOSTED_RESULT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		expect(server.getSearxngSearchRequests()).toHaveLength(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"BUGFIX-001 context size - explicit official GPT and OpenAI-compatible DeepSeek values survive effective projection",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await openApiSettings(page, sidebar)

		const officialProfileName = E2E_PROFILE_NAMES.mockOpenAiOfficialResponses
		const officialCard = await openProfileEditor(sidebar, officialProfileName)
		await openModelConfiguration(officialCard)
		await setTextField(officialCard, "Context Window Size", "333333")
		await waitForProfile(dlineDir, officialProfileName, (profile) => profile.openai?.capabilities?.contextWindow === 333_333)
		await expect(officialCard.getByText("333K", { exact: true })).toBeVisible()

		const compatibleProfileName = E2E_PROFILE_NAMES.persistence
		const compatibleCard = await openProfileEditor(sidebar, compatibleProfileName)
		await openModelConfiguration(compatibleCard)
		const modelInput = compatibleCard.locator('vscode-text-field[placeholder="Enter Model ID..."] input')
		await modelInput.fill("custom-deepseek-model")
		await modelInput.press("Tab")
		await setTextField(compatibleCard, "Context Window Size", "256000")
		await waitForProfile(
			dlineDir,
			compatibleProfileName,
			(profile) => profile.modelId === "custom-deepseek-model" && profile.openai?.capabilities?.contextWindow === 256_000,
		)

		await sidebar.getByRole("button", { name: "Done" }).click()
		const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
		await modelSwitcher.click()
		await sidebar.getByRole("option").filter({ hasText: officialProfileName }).click()
		server.enqueueResponses("openai-official-responses", {
			type: "tool",
			id: "call_bugfix_001_gpt_context",
			name: "attempt_completion",
			arguments: { result: "E2E_GPT_CONTEXT_OK" },
		})
		await sendTask(sidebar, "Verify the official GPT context projection.")
		await expect(sidebar.getByText("E2E_GPT_CONTEXT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const expandTaskHeader = sidebar.getByLabel("Expand task header")
		if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
		const contextMaximum = sidebar.locator('[title="Maximum context window size for this model"]')
		await expect(contextMaximum).toHaveText("333.3k")

		await modelSwitcher.click()
		await sidebar.getByRole("option").filter({ hasText: compatibleProfileName }).click()
		await expect(contextMaximum).toHaveText("256.0k")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
