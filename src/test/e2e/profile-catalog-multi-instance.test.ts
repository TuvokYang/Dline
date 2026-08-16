import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { e2e } from "./utils/helpers"
import { MultiInstanceLauncher, type MultiInstanceSurface } from "./utils/multi-instance"

interface StoredProfile {
	id: string
	name: string
}

async function readProfiles(dlineDir: string): Promise<StoredProfile[]> {
	return JSON.parse(await readFile(path.join(dlineDir, "data", "settings", "api_profiles.json"), "utf8")) as StoredProfile[]
}

async function openApiSettings(surface: MultiInstanceSurface): Promise<void> {
	await surface.page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(surface.sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible({
		timeout: 30_000,
	})
}

function profileNameInput(surface: MultiInstanceSurface, profileName: string) {
	return surface.sidebar.locator(`input[value=${JSON.stringify(profileName)}]`)
}

async function renameProfile(surface: MultiInstanceSurface, currentName: string, nextName: string): Promise<void> {
	const input = profileNameInput(surface, currentName)
	await expect(input).toBeVisible()
	await input.fill(nextName)
	await input.blur()
}

e2e(
	"Profile Catalog - concurrent stale-list edits merge and external rename converges across VS Code instances",
	async ({ dlineDir, dlineDocsDir, server, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		const launcher = new MultiInstanceLauncher({
			dlineDir,
			dlineDocsDir,
			server,
			testInfo,
			workspaceDir,
		})
		try {
			const instanceA = await launcher.launch("profile-instance-a")
			const instanceB = await launcher.launch("profile-instance-b")
			await Promise.all([openApiSettings(instanceA), openApiSettings(instanceB)])

			const profileAName = E2E_PROFILE_NAMES.persistence
			const profileBName = E2E_PROFILE_NAMES.mockDeepSeek
			const initialProfiles = await readProfiles(dlineDir)
			const profileAId = initialProfiles.find((profile) => profile.name === profileAName)?.id
			const profileBId = initialProfiles.find((profile) => profile.name === profileBName)?.id
			if (!profileAId || !profileBId) throw new Error("Required E2E Profiles are missing")

			const profileAConcurrentName = `${profileAName} Concurrent A`
			const profileBConcurrentName = `${profileBName} Concurrent B`
			await Promise.all([
				renameProfile(instanceA, profileAName, profileAConcurrentName),
				renameProfile(instanceB, profileBName, profileBConcurrentName),
			])

			await expect
				.poll(
					async () => {
						const profiles = await readProfiles(dlineDir)
						return {
							profileA: profiles.find((profile) => profile.id === profileAId)?.name,
							profileB: profiles.find((profile) => profile.id === profileBId)?.name,
						}
					},
					{ timeout: 15_000 },
				)
				.toEqual({
					profileA: profileAConcurrentName,
					profileB: profileBConcurrentName,
				})

			for (const surface of [instanceA, instanceB]) {
				await expect(profileNameInput(surface, profileAConcurrentName)).toBeVisible({ timeout: 15_000 })
				await expect(profileNameInput(surface, profileBConcurrentName)).toBeVisible({ timeout: 15_000 })
			}

			const externallyRenamedProfile = `${profileAName} External Commit`
			await renameProfile(instanceA, profileAConcurrentName, externallyRenamedProfile)
			await expect
				.poll(async () => (await readProfiles(dlineDir)).find((profile) => profile.id === profileAId)?.name, {
					timeout: 15_000,
				})
				.toBe(externallyRenamedProfile)

			await expect(profileNameInput(instanceB, externallyRenamedProfile)).toBeVisible({ timeout: 15_000 })
			await expect(profileNameInput(instanceB, profileAConcurrentName)).toHaveCount(0)
		} finally {
			await launcher.dispose()
		}
	},
)
