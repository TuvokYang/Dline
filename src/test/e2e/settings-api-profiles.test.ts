import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	id: string
	name: string
	provider: string
	modelId: string
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
