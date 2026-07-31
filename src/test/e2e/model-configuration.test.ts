import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { ApiFormat } from "../../shared/proto/dline/models/metadata"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { startSettingControlStabilityObserver, stopSettingControlStabilityObserver } from "./utils/ui-stability"

interface StoredProfile {
	id: string
	name: string
	provider: string
	modelId: string
	baseUrl?: string
	openai?: {
		apiFormat?: string
		customModelEnabled?: boolean
		serviceTier?: string
		azureApiVersion?: string
		azureIdentity?: boolean
		streamIncludeUsage?: boolean
		openAiHeaders?: Record<string, string>
		reasoning?: {
			enableThinking?: boolean
			effort?: string
			thinkingBudget?: number
		}
		capabilities?: {
			contextWindow?: number
			maxTokens?: number
			supportsPromptCache?: boolean
			supportsTools?: boolean
		}
		pricing?: {
			inputPrice?: number
			outputPrice?: number
			cacheWritesPrice?: number
			cacheReadsPrice?: number
		}
	}
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")

async function readProfiles(dlineDir: string): Promise<StoredProfile[]> {
	return JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
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

async function openModelConfiguration(sidebar: Frame, profileName: string): Promise<Locator> {
	const card = getProfileCard(sidebar, profileName)
	await expect(card).toHaveCount(1)

	const modelConfiguration = card.getByText("Model Configuration", { exact: true })
	if (!(await modelConfiguration.isVisible())) {
		await card.getByRole("button").first().press("Enter")
	}
	await expect(modelConfiguration).toBeVisible()

	const contextWindow = card.getByRole("textbox", { name: "Context Window Size" })
	if (!(await contextWindow.isVisible())) {
		await modelConfiguration.click()
	}
	await expect(contextWindow).toBeVisible()
	return card
}

async function setCapability(card: Locator, label: string, value: boolean): Promise<void> {
	const checkbox = card.locator("vscode-checkbox").filter({ hasText: label })
	await expect(checkbox).toHaveCount(1)
	await expect(checkbox).toBeVisible()
	const current = await checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if (current !== value) {
		await checkbox.click()
	}
	await expect.poll(() => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))).toBe(value)
}

async function setTextField(card: Locator, name: string, value: string): Promise<void> {
	const field = card.getByRole("textbox", { name })
	await field.fill(value)
	await field.press("Tab")
	await expect(field).toHaveValue(value)
}

async function setPlaceholderField(card: Locator, placeholder: string, value: string): Promise<void> {
	const field = card.locator(`vscode-text-field[placeholder=${JSON.stringify(placeholder)}] input`)
	await expect(field).toHaveCount(1)
	await field.fill(value)
	await field.press("Tab")
	await expect(field).toHaveValue(value)
}

async function selectLabeledOption(card: Locator, sidebar: Frame, label: string, option: string): Promise<void> {
	const container = card.getByText(label, { exact: true }).locator("..")
	const trigger = container.getByRole("combobox")
	await expect(trigger).toHaveCount(1)
	await trigger.click()
	await sidebar.getByRole("option", { name: option, exact: true }).click()
}

async function expectAdvancedValue(card: Locator, label: string, value: string): Promise<void> {
	const row = card.getByText(label, { exact: true }).locator("..")
	if (!(await row.isVisible())) {
		await card.getByText("Advanced", { exact: true }).last().click()
	}
	await expect(row).toBeVisible()
	await expect(row).toContainText(value)
}

async function expectModelInfoValue(card: Locator, label: string, value: string): Promise<void> {
	const row = card.getByText(label, { exact: true }).locator("..")
	await expect(row).toBeVisible()
	await expect(row).toContainText(value)
}

e2e(
	"Model configuration - updates Model Info immediately and persists after reopening VS Code",
	async ({ dlineDir, helper, openVSCode, workspaceDir }) => {
		e2e.setTimeout(180_000)
		const profileName = E2E_PROFILE_NAMES.persistence
		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined

		try {
			firstApp = await openVSCode(workspaceDir)
			const firstPage = await firstApp.firstWindow()
			await E2ETestHelper.openClineSidebar(firstPage)
			const firstSidebar = await helper.getSidebar(firstPage)
			await helper.signin(firstSidebar)
			await openApiSettings(firstPage, firstSidebar)

			const officialCard = await openModelConfiguration(firstSidebar, E2E_PROFILE_NAMES.mockOpenAiOfficialResponses)
			await expect(officialCard.locator("vscode-dropdown#model-id")).toContainText("gpt-5.4-mini")
			const officialApiFormat = officialCard.getByRole("combobox", { name: "API Format" })
			await expect(officialApiFormat).toHaveValue(String(ApiFormat.OPENAI_RESPONSES))
			await officialApiFormat.selectOption(String(ApiFormat.OPENAI_CHAT))
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.mockOpenAiOfficialResponses,
				(profile) => profile.openai?.apiFormat === "OPENAI_CHAT",
			)
			await officialApiFormat.selectOption(String(ApiFormat.OPENAI_RESPONSES))
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.mockOpenAiOfficialResponses,
				(profile) => profile.openai?.apiFormat === "OPENAI_RESPONSES",
			)

			const card = await openModelConfiguration(firstSidebar, profileName)
			await setPlaceholderField(card, "Enter base URL...", "https://compatible.example.test/v1")
			await setPlaceholderField(card, "Enter Model ID...", "e2e-compatible-custom")
			const apiFormatSelector = card.getByRole("combobox", { name: "API Format" })
			await expect(apiFormatSelector).toHaveValue(String(ApiFormat.OPENAI_CHAT))
			await apiFormatSelector.selectOption(String(ApiFormat.OPENAI_RESPONSES))
			await expect(apiFormatSelector).toHaveValue(String(ApiFormat.OPENAI_RESPONSES))
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.apiFormat === "OPENAI_RESPONSES")

			await startSettingControlStabilityObserver(
				firstSidebar,
				{
					label: "Supports Prompt Cache",
				},
				"checked",
			)
			await setCapability(card, "Supports Prompt Cache", false)
			await expectAdvancedValue(card, "Prompt Caching", "No")
			const promptCacheSamples = await stopSettingControlStabilityObserver(firstSidebar)
			const firstUncheckedSample = promptCacheSamples.indexOf("false")
			expect(firstUncheckedSample).toBeGreaterThanOrEqual(0)
			expect(promptCacheSamples.slice(firstUncheckedSample)).not.toContain("true")
			await setCapability(card, "Supports Prompt Cache", true)
			await expectAdvancedValue(card, "Prompt Caching", "Yes")
			await setCapability(card, "Supports Native Tool Calls", false)
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.capabilities?.supportsTools === false)
			await setCapability(card, "Supports Native Tool Calls", true)
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.capabilities?.supportsTools === true)

			await setTextField(card, "Context Window Size", "234567")
			await setTextField(card, "Max Output Tokens", "32768")
			await setTextField(card, "Input Price ($/1M tokens)", "1.25")
			await setTextField(card, "Output Price ($/1M tokens)", "2.5")
			await setTextField(card, "Cache Writes ($/M)", "0.75")
			await setTextField(card, "Cache Reads ($/M)", "0.25")
			await expect(card.getByText("235K", { exact: true })).toBeVisible()
			await expectModelInfoValue(card, "Input:", "$1.25/M")
			await expectModelInfoValue(card, "Output:", "$2.50/M")

			const storedBeforeReasoning = await waitForProfile(
				dlineDir,
				profileName,
				(profile) =>
					profile.baseUrl === "https://compatible.example.test/v1" &&
					profile.modelId === "e2e-compatible-custom" &&
					profile.openai?.customModelEnabled === true &&
					profile.openai?.capabilities?.contextWindow === 234_567 &&
					profile.openai.capabilities.maxTokens === 32_768 &&
					profile.openai.capabilities.supportsPromptCache === true &&
					profile.openai.capabilities.supportsTools === true &&
					profile.openai?.pricing?.inputPrice === 1.25 &&
					profile.openai.pricing.outputPrice === 2.5 &&
					profile.openai.pricing.cacheWritesPrice === 0.75 &&
					profile.openai.pricing.cacheReadsPrice === 0.25,
			)
			expect(storedBeforeReasoning.openai?.capabilities?.contextWindow).toBe(234_567)
			expect(storedBeforeReasoning.openai?.pricing).toMatchObject({
				inputPrice: 1.25,
				outputPrice: 2.5,
				cacheWritesPrice: 0.75,
				cacheReadsPrice: 0.25,
			})

			await setCapability(card, "Enable Thinking", false)
			await expect(card.getByText("Reasoning Effort", { exact: true }).last()).not.toBeVisible()
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.reasoning?.enableThinking === false)
			await setCapability(card, "Enable Thinking", true)
			await expect(card.getByText("Reasoning Effort", { exact: true }).last()).toBeVisible()
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.reasoning?.enableThinking === true)
			await selectLabeledOption(card, firstSidebar, "Thinking Mode", "Thinking Budget")
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.reasoning?.thinkingBudget === 1_024)
			await selectLabeledOption(card, firstSidebar, "Thinking Mode", "Reasoning Effort")
			await selectLabeledOption(card, firstSidebar, "Reasoning Effort", "Ultra")
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.reasoning?.effort === "ultra")
			await selectLabeledOption(card, firstSidebar, "Service Tier", "Priority")
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.serviceTier === "priority")

			await card.getByRole("button", { name: "Add Header", exact: true }).click()
			await setPlaceholderField(card, "Header name", "X-Dline-E2E")
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.openAiHeaders?.["X-Dline-E2E"] === "")
			await setPlaceholderField(card, "Header value", "header-value")
			await waitForProfile(
				dlineDir,
				profileName,
				(profile) => profile.openai?.openAiHeaders?.["X-Dline-E2E"] === "header-value",
			)
			await setCapability(card, "Set Azure API version", true)
			await setPlaceholderField(card, "Default: 2024-10-01-preview", "2025-04-01-preview")
			await setCapability(card, "Use Azure Identity Authentication", true)
			await setCapability(card, "Include usage stats in stream responses", false)
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.azureApiVersion === "2025-04-01-preview")
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.azureIdentity === true)
			await waitForProfile(dlineDir, profileName, (profile) => profile.openai?.streamIncludeUsage !== true)

			await firstApp.close()
			firstApp = undefined
			helper.clearCachedFrame()

			reopenedApp = await openVSCode(workspaceDir)
			const reopenedPage = await reopenedApp.firstWindow()
			await E2ETestHelper.openClineSidebar(reopenedPage)
			const reopenedSidebar = await helper.getSidebar(reopenedPage)
			await helper.signin(reopenedSidebar)
			await openApiSettings(reopenedPage, reopenedSidebar)

			const reopenedCard = await openModelConfiguration(reopenedSidebar, profileName)
			await expect(reopenedCard.locator('vscode-text-field[placeholder="Enter base URL..."] input')).toHaveValue(
				"https://compatible.example.test/v1",
			)
			await expect(reopenedCard.locator('vscode-text-field[placeholder="Enter Model ID..."] input')).toHaveValue(
				"e2e-compatible-custom",
			)
			await expect(reopenedCard.getByRole("combobox", { name: "API Format" })).toHaveValue(
				String(ApiFormat.OPENAI_RESPONSES),
			)
			await expect(reopenedCard.getByRole("textbox", { name: "Context Window Size" })).toHaveValue("234567")
			await expect(reopenedCard.getByRole("textbox", { name: "Max Output Tokens" })).toHaveValue("32768")
			await expect(reopenedCard.getByRole("textbox", { name: "Input Price ($/1M tokens)" })).toHaveValue("1.25")
			await expect(reopenedCard.getByRole("textbox", { name: "Output Price ($/1M tokens)" })).toHaveValue("2.5")
			await expect(reopenedCard.getByRole("textbox", { name: "Cache Writes ($/M)" })).toHaveValue("0.75")
			await expect(reopenedCard.getByRole("textbox", { name: "Cache Reads ($/M)" })).toHaveValue("0.25")
			await setCapability(reopenedCard, "Supports Prompt Cache", true)
			await setCapability(reopenedCard, "Supports Native Tool Calls", true)
			await setCapability(reopenedCard, "Enable Thinking", true)
			await expectAdvancedValue(reopenedCard, "Prompt Caching", "Yes")
			await expect(reopenedCard.getByText("Reasoning Effort", { exact: true }).last()).toBeVisible()
			await expect(reopenedCard.getByText("Ultra", { exact: true }).last()).toBeVisible()
			await expect(reopenedCard.getByText("Priority", { exact: true }).last()).toBeVisible()
			await expect(reopenedCard.locator('vscode-text-field[placeholder="Header name"] input')).toHaveValue("X-Dline-E2E")
			await expect(reopenedCard.locator('vscode-text-field[placeholder="Header value"] input')).toHaveValue("header-value")
			await expect(reopenedCard.locator('vscode-text-field[placeholder="Default: 2024-10-01-preview"] input')).toHaveValue(
				"2025-04-01-preview",
			)
			await expect
				.poll(() =>
					reopenedCard
						.locator("vscode-checkbox")
						.filter({ hasText: "Use Azure Identity Authentication" })
						.evaluate((element) => Boolean((element as HTMLInputElement).checked)),
				)
				.toBe(true)
			await expect
				.poll(() =>
					reopenedCard
						.locator("vscode-checkbox")
						.filter({ hasText: "Include usage stats in stream responses" })
						.evaluate((element) => Boolean((element as HTMLInputElement).checked)),
				)
				.toBe(false)
			await expect(reopenedCard.getByText("235K", { exact: true })).toBeVisible()
			await expectModelInfoValue(reopenedCard, "Input:", "$1.25/M")
			await expectModelInfoValue(reopenedCard, "Output:", "$2.50/M")
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)

e2e(
	"OpenAI task profiles - selection, rename, and task-local switch route subsequent turns",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await openApiSettings(page, sidebar)

		const mockCard = await openModelConfiguration(sidebar, E2E_PROFILE_NAMES.mockOpenAi)
		await setTextField(mockCard, "Context Window Size", "131072")
		await selectLabeledOption(mockCard, sidebar, "Service Tier", "Priority")
		await waitForProfile(
			dlineDir,
			E2E_PROFILE_NAMES.mockOpenAi,
			(profile) =>
				profile.openai?.apiFormat === "OPENAI_CHAT" &&
				profile.openai.capabilities?.contextWindow === 131_072 &&
				profile.openai.serviceTier === "priority",
		)

		const responsesCard = await openModelConfiguration(sidebar, E2E_PROFILE_NAMES.mockOpenAiResponses)
		await setTextField(responsesCard, "Context Window Size", "262144")
		await setCapability(responsesCard, "Enable Thinking", true)
		await selectLabeledOption(responsesCard, sidebar, "Thinking Mode", "Reasoning Effort")
		await selectLabeledOption(responsesCard, sidebar, "Reasoning Effort", "Ultra")
		await selectLabeledOption(responsesCard, sidebar, "Service Tier", "Flex")
		await waitForProfile(
			dlineDir,
			E2E_PROFILE_NAMES.mockOpenAiResponses,
			(profile) =>
				profile.openai?.apiFormat === "OPENAI_RESPONSES" &&
				profile.openai.capabilities?.contextWindow === 262_144 &&
				profile.openai.reasoning?.effort === "ultra" &&
				profile.openai.serviceTier === "flex",
		)

		await sidebar.getByRole("button", { name: "Done" }).click()
		const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
		await modelSwitcher.click()
		await sidebar.getByRole("option").filter({ hasText: E2E_PROFILE_NAMES.mockOpenAiResponses }).click()
		await expect(modelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAiResponses)
		await modelSwitcher.click()
		await sidebar.getByRole("option").filter({ hasText: E2E_PROFILE_NAMES.mockOpenAi }).click()
		await expect(modelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAi)

		server.resetOpenAiMock()
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_openai_chat_profile_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_OPENAI_CHAT_PROFILE_OK" },
			expectedRequestIncludes: ["E2E_OPENAI_CHAT_PROFILE_TURN"],
		})
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_openai_responses_profile_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_OPENAI_RESPONSES_PROFILE_OK" },
			expectedRequestIncludes: ["E2E_OPENAI_RESPONSES_PROFILE_TURN"],
		})

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_OPENAI_CHAT_PROFILE_TURN")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("E2E_OPENAI_CHAT_PROFILE_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
		const chatRequest = server.getMockConsumptions("openai-compatible-chat")[0]
		expect(chatRequest).toMatchObject({
			protocol: "openai-chat",
			thinking: { mode: "effort", effort: "high" },
		})
		expect(chatRequest.requestBody).toMatchObject({
			model: "dline-e2e-model",
			service_tier: "priority",
			reasoning_effort: "high",
		})

		const expandTaskHeader = sidebar.getByLabel("Expand task header")
		if (await expandTaskHeader.isVisible()) {
			await expandTaskHeader.click()
		}
		await expect(modelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAi)
		const contextMaximum = sidebar.locator('[title="Maximum context window size for this model"]')
		await expect(contextMaximum).toHaveText("131.1k")

		await openApiSettings(page, sidebar)
		const renamedProfile = `${E2E_PROFILE_NAMES.mockOpenAi} Renamed`
		const profileNameInput = sidebar.locator(`input[value=${JSON.stringify(E2E_PROFILE_NAMES.mockOpenAi)}]`)
		await profileNameInput.fill(renamedProfile)
		await profileNameInput.blur()
		await waitForProfile(dlineDir, renamedProfile, () => true)
		await sidebar.getByRole("button", { name: "Done" }).click()

		await expect(modelSwitcher).toHaveText(renamedProfile)
		await expect(contextMaximum).toHaveText("131.1k")

		await modelSwitcher.click()
		await sidebar.getByRole("option").filter({ hasText: E2E_PROFILE_NAMES.mockOpenAiResponses }).click()
		await expect(modelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAiResponses)
		await expect(contextMaximum).toHaveText("262.1k")

		await expect(input).toBeEnabled()
		await input.fill("E2E_OPENAI_RESPONSES_PROFILE_TURN")
		await input.press("Enter")
		await expect(sidebar.getByText("E2E_OPENAI_RESPONSES_PROFILE_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(1)
		const responsesRequest = server.getMockConsumptions("openai-compatible-responses")[0]
		expect(responsesRequest).toMatchObject({
			protocol: "openai-responses",
			thinking: { mode: "effort", effort: "ultra" },
		})
		expect(responsesRequest.requestBody).toMatchObject({
			model: "dline-e2e-model",
			service_tier: "flex",
			reasoning: { effort: "ultra" },
		})
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
