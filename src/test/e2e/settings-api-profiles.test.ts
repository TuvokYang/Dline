import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

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
