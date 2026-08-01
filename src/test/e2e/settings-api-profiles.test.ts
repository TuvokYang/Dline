import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { ApiFormat } from "../../shared/proto/dline/models/metadata"
import PROVIDERS from "../../shared/providers/providers.json"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	id: string
	name: string
	provider: string
	modelId?: string
	baseUrl?: string
	deepseek?: { apiFormat?: string }
	bedrock?: Record<string, unknown>
	sapaicore?: Record<string, unknown>
}

interface StoredProviderSecret {
	name: string
	provider: string
	secrets: Record<string, string>
}

interface ProviderModel {
	id?: string
	name?: string
	[key: string]: unknown
}

interface ProviderCatalog {
	defaultModelId?: string
	models: Record<string, ProviderModel>
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T
}

const API_KEY_LABELS: Partial<Record<string, string>> = {
	aihubmix: "AIHubMix API Key",
	anthropic: "Anthropic API Key",
	asksage: "AskSage API Key",
	baseten: "Baseten API Key",
	cerebras: "Cerebras API Key",
	deepseek: "DeepSeek API Key",
	dify: "Dify API Key",
	doubao: "Doubao API Key",
	fireworks: "Fireworks API Key",
	gemini: "Gemini API Key",
	groq: "Groq API Key",
	hicap: "Hicap API Key",
	"huawei-cloud-maas": "Huawei Cloud MaaS API Key",
	huggingface: "Hugging Face API Key",
	litellm: "API Key",
	minimax: "MiniMax API Key",
	mistral: "Mistral API Key",
	moonshot: "Moonshot API Key",
	nebius: "Nebius API Key",
	nousResearch: "Nous Research API Key",
	ollama: "Ollama API Key",
	"openai-codex": "OpenAI Codex API Key",
	openai: "OpenAI API Key",
	openrouter: "OpenRouter API Key",
	qwen: "Qwen API Key",
	requesty: "Requesty API Key",
	sambanova: "Sambanova API Key",
	sapaicore: "SAP AI Core API Key",
	together: "Together API Key",
	"vercel-ai-gateway": "Vercel AI Gateway API Key",
	wandb: "W&B API Key",
	xai: "xAI API Key",
	zai: "Z AI API Key",
}

e2e("Settings API Config - shows configured profiles without changing them", async ({ helper, page, sidebar }) => {
	await helper.signin(sidebar)
	await page.getByRole("button", { name: "Settings", exact: true }).click()

	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
	await expect(sidebar.getByText("Add API")).toBeVisible()
	await expect(sidebar.getByRole("textbox").first()).toBeVisible()
})

e2e(
	"Settings API Config - persists a profile edit after reopening VS Code",
	async ({ dlineDir, helper, openVSCode, workspaceDir }) => {
		e2e.setTimeout(120_000)
		const renamedProfile = `${E2E_PROFILE_NAMES.persistence} Reopened`
		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined

		try {
			firstApp = await openVSCode(workspaceDir)
			const firstPage = await firstApp.firstWindow()
			await E2ETestHelper.openClineSidebar(firstPage)
			const firstSidebar = await helper.getSidebar(firstPage)
			await helper.signin(firstSidebar)
			await firstPage.getByRole("button", { name: "Settings", exact: true }).click()
			await expect(firstSidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()

			const profileNameInput = firstSidebar.locator(`input[value="${E2E_PROFILE_NAMES.persistence}"]`)
			await expect(profileNameInput).toBeVisible()
			await profileNameInput.fill(renamedProfile)
			await profileNameInput.blur()

			const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
			await E2ETestHelper.waitUntil(async () => {
				const profiles = JSON.parse(await readFile(profilesPath, "utf8")) as Array<{ name?: string }>
				return profiles.some((profile) => profile.name === renamedProfile)
			})

			await firstApp.close()
			firstApp = undefined
			helper.clearCachedFrame()

			reopenedApp = await openVSCode(workspaceDir)
			const reopenedPage = await reopenedApp.firstWindow()
			await E2ETestHelper.openClineSidebar(reopenedPage)
			const reopenedSidebar = await helper.getSidebar(reopenedPage)
			await helper.signin(reopenedSidebar)
			await reopenedPage.getByRole("button", { name: "Settings", exact: true }).click()

			await expect(reopenedSidebar.locator(`input[value="${renamedProfile}"]`)).toBeVisible()
			await expect(reopenedSidebar.locator(`input[value="${E2E_PROFILE_NAMES.persistence}"]`)).toHaveCount(0)
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)

e2e(
	"Settings API Config - stores Bedrock and SAP structured credentials only in provider secrets and restores them",
	async ({ dlineDir, helper, openVSCode, workspaceDir }) => {
		e2e.setTimeout(180_000)
		const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
		const providerSecretsPath = path.join(dlineDir, "data", "secrets", "provider_secrets.json")
		let firstApp: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined

		const readProviderSecrets = async () =>
			readFile(providerSecretsPath, "utf8")
				.then((contents) => JSON.parse(contents) as Record<string, StoredProviderSecret>)
				.catch(() => ({}))

		try {
			firstApp = await openVSCode(workspaceDir)
			const firstPage = await firstApp.firstWindow()
			await E2ETestHelper.openClineSidebar(firstPage)
			const firstSidebar = await helper.getSidebar(firstPage)
			await helper.signin(firstSidebar)
			await firstPage.getByRole("button", { name: "Settings", exact: true }).click()
			await expect(firstSidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()

			const addProviderProfile = async (provider: string) => {
				const existingIds = new Set((await readJson<StoredProfile[]>(profilesPath)).map((profile) => profile.id))
				await firstSidebar.getByRole("button", { name: "Add API" }).click()
				const card = firstSidebar.getByTestId("api-profile-card").last()
				const id = await E2ETestHelper.waitForValue(async () => {
					const profiles = await readJson<StoredProfile[]>(profilesPath)
					return profiles.find((profile) => !existingIds.has(profile.id))?.id
				})
				await card.getByRole("combobox", { name: "Provider", exact: true }).selectOption(provider)
				const stored = await E2ETestHelper.waitForValue(async () => {
					const profile = (await readJson<StoredProfile[]>(profilesPath)).find((candidate) => candidate.id === id)
					return profile?.provider === provider ? profile : undefined
				})
				return { card, id, name: stored.name }
			}

			const bedrock = await addProviderProfile("bedrock")
			for (const [name, value, secretField] of [
				["AWS Access Key", "E2E_BEDROCK_ACCESS", "awsAccessKey"],
				["AWS Secret Key", "E2E_BEDROCK_SECRET", "awsSecretKey"],
				["AWS Session Token", "E2E_BEDROCK_SESSION", "awsSessionToken"],
			] as const) {
				const field = bedrock.card.getByRole("textbox", { name, exact: true })
				await expect(field).toBeVisible()
				await field.fill(value)
				await field.press("Tab")
				await E2ETestHelper.waitUntil(
					async () => (await readProviderSecrets())[bedrock.id]?.secrets[secretField] === value,
				)
			}

			const sap = await addProviderProfile("sapaicore")
			const sapClientId = sap.card.getByRole("textbox", { name: "Client ID", exact: true })
			await sapClientId.fill("E2E_SAP_CLIENT_ID")
			await sapClientId.press("Tab")
			const sapTokenUrl = sap.card.getByRole("textbox", { name: "Token URL", exact: true })
			await sapTokenUrl.fill("https://auth.example.test/oauth/token")
			await sapTokenUrl.press("Tab")
			const sapSecret = sap.card.getByRole("textbox", { name: "Client Secret", exact: true })
			await sapSecret.fill("E2E_SAP_CLIENT_SECRET")
			await sapSecret.press("Tab")
			await E2ETestHelper.waitUntil(
				async () => (await readProviderSecrets())[sap.id]?.secrets.clientSecret === "E2E_SAP_CLIENT_SECRET",
			)
			await E2ETestHelper.waitUntil(async () => {
				const profile = (await readJson<StoredProfile[]>(profilesPath)).find((candidate) => candidate.id === sap.id)
				return (
					profile?.sapaicore?.clientId === "E2E_SAP_CLIENT_ID" &&
					profile.sapaicore.tokenUrl === "https://auth.example.test/oauth/token"
				)
			})

			const profilesOnDisk = await readFile(profilesPath, "utf8")
			expect(profilesOnDisk).not.toContain("E2E_BEDROCK_ACCESS")
			expect(profilesOnDisk).not.toContain("E2E_BEDROCK_SECRET")
			expect(profilesOnDisk).not.toContain("E2E_BEDROCK_SESSION")
			expect(profilesOnDisk).not.toContain("E2E_SAP_CLIENT_SECRET")

			await firstApp.close()
			firstApp = undefined
			helper.clearCachedFrame()

			reopenedApp = await openVSCode(workspaceDir)
			const reopenedPage = await reopenedApp.firstWindow()
			await E2ETestHelper.openClineSidebar(reopenedPage)
			const reopenedSidebar = await helper.getSidebar(reopenedPage)
			await helper.signin(reopenedSidebar)
			await reopenedPage.getByRole("button", { name: "Settings", exact: true }).click()

			const reopenedBedrock = reopenedSidebar
				.getByTestId("api-profile-card")
				.filter({ has: reopenedSidebar.getByRole("textbox", { name: bedrock.name, exact: true }) })
			await expect(reopenedBedrock).toHaveCount(1)
			await reopenedBedrock.getByRole("button").first().press("Enter")
			await expect(reopenedBedrock.getByRole("textbox", { name: "AWS Access Key", exact: true })).toHaveValue(
				"E2E_BEDROCK_ACCESS",
			)
			await expect(reopenedBedrock.getByRole("textbox", { name: "AWS Secret Key", exact: true })).toHaveValue(
				"E2E_BEDROCK_SECRET",
			)
			await expect(reopenedBedrock.getByRole("textbox", { name: "AWS Session Token", exact: true })).toHaveValue(
				"E2E_BEDROCK_SESSION",
			)

			const reopenedSap = reopenedSidebar
				.getByTestId("api-profile-card")
				.filter({ has: reopenedSidebar.getByRole("textbox", { name: sap.name, exact: true }) })
			await expect(reopenedSap).toHaveCount(1)
			await reopenedSap.getByRole("button").first().press("Enter")
			await expect(reopenedSap.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("E2E_SAP_CLIENT_ID")
			await expect(reopenedSap.getByRole("textbox", { name: "Client Secret", exact: true })).toHaveValue(
				"E2E_SAP_CLIENT_SECRET",
			)
			await expect(reopenedSap.getByRole("textbox", { name: "Token URL", exact: true })).toHaveValue(
				"https://auth.example.test/oauth/token",
			)
		} finally {
			await reopenedApp?.close()
			await firstApp?.close()
		}
	},
)

e2e(
	"Settings API Config - hot reloads provider models and persists the selected model",
	async ({ dlineDir, dlineHomeDir, helper, page, sidebar }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		await page.getByRole("button", { name: "Settings", exact: true }).click()
		await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()

		const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
		const existingProfileIds = new Set((await readJson<StoredProfile[]>(profilesPath)).map((profile) => profile.id))
		await sidebar.getByRole("button", { name: "Add API" }).click()
		const profileCard = sidebar.getByTestId("api-profile-card").last()
		await expect(profileCard.locator('input[value="New Model"]')).toBeVisible()
		const profileId = await E2ETestHelper.waitForValue(async () => {
			const profiles = await readJson<StoredProfile[]>(profilesPath)
			return profiles.find((profile) => !existingProfileIds.has(profile.id))?.id
		})
		await profileCard.getByRole("combobox", { name: "Provider" }).selectOption("deepseek")
		await E2ETestHelper.waitUntil(async () => {
			const profiles = await readJson<StoredProfile[]>(profilesPath)
			return profiles.find((profile) => profile.id === profileId)?.modelId === "deepseek-v4-pro"
		})

		const apiFormatSelector = profileCard.getByRole("combobox", { name: "API Format" })
		await expect(apiFormatSelector).toHaveValue(String(ApiFormat.OPENAI_CHAT))
		await expect(apiFormatSelector.getByRole("option", { name: "OpenAI Responses" })).toHaveCount(1)
		await apiFormatSelector.selectOption(String(ApiFormat.OPENAI_RESPONSES))
		await E2ETestHelper.waitUntil(async () => {
			const profiles = await readJson<StoredProfile[]>(profilesPath)
			return profiles.find((profile) => profile.id === profileId)?.deepseek?.apiFormat === "OPENAI_RESPONSES"
		})
		await apiFormatSelector.selectOption(String(ApiFormat.OPENAI_CHAT))

		const providerPath = path.join(dlineHomeDir, "providers", "deepseek.json")
		const catalog = await readJson<ProviderCatalog>(providerPath)
		const templateModel = catalog.models[catalog.defaultModelId ?? ""] ?? Object.values(catalog.models)[0]
		if (!templateModel) throw new Error("DeepSeek provider catalog has no model template")

		const modelId = `deepseek-e2e-hot-reload-${Date.now()}`
		catalog.models[modelId] = { ...templateModel, id: modelId, name: modelId }
		await writeFile(providerPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")

		const modelSelector = profileCard.locator("vscode-dropdown#model-id")
		await expect(modelSelector.locator(`vscode-option[value="${modelId}"]`)).toHaveCount(1, { timeout: 15_000 })
		await modelSelector.evaluate((element, value) => {
			;(element as HTMLInputElement).value = value
			element.dispatchEvent(new Event("change", { bubbles: true }))
		}, modelId)

		await E2ETestHelper.waitUntil(async () => {
			const profiles = await readJson<StoredProfile[]>(profilesPath)
			return profiles.find((profile) => profile.id === profileId)?.modelId === modelId
		})
		expect((await readJson<StoredProfile[]>(profilesPath)).find((profile) => profile.id === profileId)?.modelId).toBe(modelId)
	},
)

e2e(
	"Settings API Config - selects every registered provider and stores exposed API keys only in secrets",
	async ({ dlineDir, helper, page, sidebar }) => {
		e2e.setTimeout(600_000)
		await helper.signin(sidebar)
		await page.getByRole("button", { name: "Settings", exact: true }).click()
		await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()

		const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
		const apiKeysPath = path.join(dlineDir, "data", "secrets", "api_keys.json")
		const existingProfileIds = new Set((await readJson<StoredProfile[]>(profilesPath)).map((profile) => profile.id))
		await sidebar.getByRole("button", { name: "Add API" }).click()
		const profileCard = sidebar.getByTestId("api-profile-card").last()
		const profileId = await E2ETestHelper.waitForValue(async () => {
			const profiles = await readJson<StoredProfile[]>(profilesPath)
			return profiles.find((profile) => !existingProfileIds.has(profile.id))?.id
		})
		const providerSelector = profileCard.getByRole("combobox", { name: "Provider", exact: true })

		for (const { value: provider } of PROVIDERS.list) {
			await providerSelector.selectOption(provider)
			const storedProfile = await E2ETestHelper.waitForValue(async () => {
				const profile = (await readJson<StoredProfile[]>(profilesPath)).find((candidate) => candidate.id === profileId)
				return profile?.provider === provider ? profile : undefined
			})
			const defaultName = `${provider}:${storedProfile.modelId ?? ""}`
			const escapedDefaultName = defaultName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			expect(storedProfile.name).toMatch(new RegExp(`^${escapedDefaultName}(?::\\d+)?$`))
			await expect(profileCard.locator("input").first()).toHaveValue(storedProfile.name)

			const apiKeyLabel = API_KEY_LABELS[provider]
			if (!apiKeyLabel) continue

			if (provider === "ollama") {
				const customBaseUrl = profileCard.locator("vscode-checkbox").filter({ hasText: "Use custom base URL" })
				await customBaseUrl.click()
				await profileCard.locator('input[placeholder="Default: http://localhost:11434"]').fill("http://127.0.0.1:11434")
				await E2ETestHelper.waitUntil(async () => {
					const profile = (await readJson<StoredProfile[]>(profilesPath)).find(
						(candidate) => candidate.id === profileId,
					)
					return profile?.baseUrl === "http://127.0.0.1:11434"
				})
			}

			const apiKey = `e2e-secret-${provider}`
			const apiKeyInput = profileCard.getByRole("textbox", { name: apiKeyLabel, exact: true })
			await expect(apiKeyInput).toBeVisible()
			await apiKeyInput.fill(apiKey)
			await apiKeyInput.press("Tab")
			await E2ETestHelper.waitUntil(async () => {
				const apiKeys = await readJson<Record<string, { apiKey?: string }>>(apiKeysPath)
				return apiKeys[profileId]?.apiKey === apiKey
			})
			expect(await readFile(profilesPath, "utf8")).not.toContain(apiKey)
		}
	},
)
