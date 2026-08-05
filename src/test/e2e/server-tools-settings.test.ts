import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredCapabilities {
	supportsImages?: boolean
	supportsBrowserAction?: boolean
	tools?: Array<string | number>
}

interface StoredProfile {
	name: string
	webSearchMode?: string
	openai?: {
		customModelEnabled?: boolean
		capabilities?: StoredCapabilities
	}
	anthropic?: {
		customModelEnabled?: boolean
		capabilities?: StoredCapabilities
	}
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")
const providerCatalogPath = (dlineDir: string, providerId: string) => path.join(dlineDir, "providers", `${providerId}.json`)

async function readProfiles(dlineDir: string): Promise<StoredProfile[]> {
	return JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
}

async function readSettings(dlineDir: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
}

function hasWebSearchCapability(capabilities: StoredCapabilities | undefined): boolean {
	return capabilities?.tools?.some((tool) => tool === "WEB_SEARCH" || tool === ServerTool.WEB_SEARCH) === true
}

async function expectBuiltInWebSearchCatalogs(dlineDir: string): Promise<void> {
	for (const providerId of ["openai", "openai-codex", "anthropic"]) {
		const catalog = await E2ETestHelper.waitForValue(async () => {
			try {
				return JSON.parse(await readFile(providerCatalogPath(dlineDir, providerId), "utf8")) as {
					models?: Record<string, { capabilities?: StoredCapabilities }>
				}
			} catch {
				return undefined
			}
		}, 15_000)
		const models = Object.values(catalog.models ?? {})
		expect(models.length).toBeGreaterThan(0)
		expect(models.every((model) => hasWebSearchCapability(model.capabilities))).toBe(true)
	}
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

async function openSidebar(app: ElectronApplication, helper: E2ETestHelper): Promise<{ page: Page; sidebar: Frame }> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return { page, sidebar }
}

async function openSettings(page: Page, sidebar: Frame): Promise<void> {
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
	if (!(await providerSelector.isVisible())) {
		await card.getByRole("button").first().press("Enter")
	}
	await expect(providerSelector).toBeVisible()
	return card
}

function capabilityCheckbox(card: Locator, label: string): Locator {
	return card.locator("vscode-checkbox").filter({ hasText: label })
}

async function setCapability(card: Locator, label: string, value: boolean): Promise<void> {
	const checkbox = capabilityCheckbox(card, label)
	await expect(checkbox).toHaveCount(1)
	await expect(checkbox).toBeVisible()
	const current = await checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if (current !== value) await checkbox.click()
	await expect.poll(() => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))).toBe(value)
}

async function openModelConfiguration(card: Locator): Promise<void> {
	const toggle = card.getByText("Model Configuration", { exact: true })
	await expect(toggle).toBeVisible()
	const webSearch = capabilityCheckbox(card, "Supports Web Search")
	if (!(await webSearch.isVisible())) await toggle.click()
	await expect(webSearch).toBeVisible()
}

async function expectCapabilities(card: Locator, expected: Record<string, boolean>): Promise<void> {
	for (const [label, value] of Object.entries(expected)) {
		const checkbox = capabilityCheckbox(card, label)
		await expect(checkbox).toBeVisible()
		await expect.poll(() => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))).toBe(value)
	}
}

e2e(
	"ServerTool settings - saves Web Tools routing and custom model capabilities after reopening VS Code",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		expect(path.resolve(dlineHomeDir)).toBe(path.resolve(dlineDir))
		expect(path.resolve(dlineDocsDir)).not.toBe(path.resolve(dlineDir))

		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined
		try {
			firstApp = await openVSCode(workspaceDir)
			const first = await openSidebar(firstApp, helper)
			await openSettings(first.page, first.sidebar)
			await expectBuiltInWebSearchCatalogs(dlineDir)

			await first.sidebar.getByTestId("tab-features").click()
			await expect(first.sidebar.getByRole("heading", { name: "Feature Settings" })).toBeVisible()
			const webToolsSwitch = first.sidebar.locator('[id="Web Tools"]')
			await expect(webToolsSwitch).toBeVisible()
			await expect(webToolsSwitch).toHaveAttribute("aria-checked", "true")
			await webToolsSwitch.click()
			await expect(webToolsSwitch).toHaveAttribute("aria-checked", "false")
			await expect.poll(async () => (await readSettings(dlineDir)).clineWebToolsEnabled).toBe(false)

			await first.sidebar.getByTestId("tab-api-config").click()
			await expect(first.sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
			const openAiCard = await openProfileEditor(first.sidebar, E2E_PROFILE_NAMES.persistence)
			const routingMode = openAiCard.getByRole("combobox", { name: "Web Search mode" })
			await expect(routingMode).toHaveValue("0")

			for (const mode of [
				{ label: "Force Local", value: "1", stored: "WEB_SEARCH_MODE_FORCE_LOCAL" },
				{ label: "Auto", value: "0", stored: "WEB_SEARCH_MODE_AUTO" },
				{ label: "Off", value: "2", stored: "WEB_SEARCH_MODE_FORCE_OFF" },
				{ label: "Force Remote", value: "3", stored: "WEB_SEARCH_MODE_FORCE_REMOTE" },
			]) {
				await routingMode.selectOption({ label: mode.label })
				await expect(routingMode).toHaveValue(mode.value)
				await waitForProfile(dlineDir, E2E_PROFILE_NAMES.persistence, (profile) => profile.webSearchMode === mode.stored)
			}

			await openModelConfiguration(openAiCard)
			await setCapability(openAiCard, "Supports Web Search", true)
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.persistence,
				(profile) => profile.openai?.capabilities?.tools?.includes("WEB_SEARCH") === true,
			)
			await setCapability(openAiCard, "Supports Browser Actions", true)
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.persistence,
				(profile) => profile.openai?.capabilities?.supportsBrowserAction === true,
			)
			await setCapability(openAiCard, "Supports Images", false)
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.persistence,
				(profile) => profile.openai?.capabilities?.supportsImages === false,
			)

			const anthropicCard = await openProfileEditor(first.sidebar, E2E_PROFILE_NAMES.mockAnthropic)
			await setCapability(anthropicCard, "Use custom model ID", true)
			await waitForProfile(
				dlineDir,
				E2E_PROFILE_NAMES.mockAnthropic,
				(profile) => profile.anthropic?.customModelEnabled === true,
			)
			await openModelConfiguration(anthropicCard)
			for (const label of ["Supports Web Search", "Supports Browser Actions", "Supports Images"]) {
				const checkbox = capabilityCheckbox(anthropicCard, label)
				const initiallyEnabled = await checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
				if (initiallyEnabled) {
					await setCapability(anthropicCard, label, false)
					await waitForProfile(dlineDir, E2E_PROFILE_NAMES.mockAnthropic, (profile) => {
						const capabilities = profile.anthropic?.capabilities
						if (label === "Supports Web Search") return hasWebSearchCapability(capabilities) === false
						if (label === "Supports Browser Actions") return capabilities?.supportsBrowserAction === false
						return capabilities?.supportsImages === false
					})
				}
				await setCapability(anthropicCard, label, true)
				await waitForProfile(dlineDir, E2E_PROFILE_NAMES.mockAnthropic, (profile) => {
					const capabilities = profile.anthropic?.capabilities
					if (label === "Supports Web Search") return hasWebSearchCapability(capabilities)
					if (label === "Supports Browser Actions") return capabilities?.supportsBrowserAction === true
					return capabilities?.supportsImages === true
				})
			}

			await firstApp.close()
			firstApp = undefined
			helper.clearCachedFrame()

			reopenedApp = await openVSCode(workspaceDir)
			const reopened = await openSidebar(reopenedApp, helper)
			await openSettings(reopened.page, reopened.sidebar)
			await reopened.sidebar.getByTestId("tab-features").click()
			await expect(reopened.sidebar.locator('[id="Web Tools"]')).toHaveAttribute("aria-checked", "false")

			await reopened.sidebar.getByTestId("tab-api-config").click()
			const reopenedOpenAiCard = await openProfileEditor(reopened.sidebar, E2E_PROFILE_NAMES.persistence)
			await expect(reopenedOpenAiCard.getByRole("combobox", { name: "Web Search mode" })).toHaveValue("3")
			await openModelConfiguration(reopenedOpenAiCard)
			await expectCapabilities(reopenedOpenAiCard, {
				"Supports Web Search": true,
				"Supports Browser Actions": true,
				"Supports Images": false,
			})

			const reopenedAnthropicCard = await openProfileEditor(reopened.sidebar, E2E_PROFILE_NAMES.mockAnthropic)
			await expect
				.poll(() =>
					capabilityCheckbox(reopenedAnthropicCard, "Use custom model ID").evaluate((element) =>
						Boolean((element as HTMLInputElement).checked),
					),
				)
				.toBe(true)
			await openModelConfiguration(reopenedAnthropicCard)
			await expectCapabilities(reopenedAnthropicCard, {
				"Supports Web Search": true,
				"Supports Browser Actions": true,
				"Supports Images": true,
			})
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)
