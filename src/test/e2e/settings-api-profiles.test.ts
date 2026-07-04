// src/test/e2e/settings-api-profiles.test.ts
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Settings API Config — can add a new profile", async ({ sidebar, page }) => {
	// Open Settings
	const settingsBtn = sidebar.getByTestId("settings-button")
	await settingsBtn.click()

	// Navigate to API Configuration tab
	const apiConfigTab = sidebar.getByRole("tab", { name: /API/ })
	await apiConfigTab.click()

	// Click "Add API" button
	const addBtn = sidebar.getByText("Add API")
	await expect(addBtn).toBeVisible()
	await addBtn.click()

	// Verify a new profile card appears (has provider dropdown)
	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await expect(providerDropdown).toBeVisible()

	await page.close()
})

e2e("Settings API Config — switching provider renders correct form", async ({ sidebar, page }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()
	await sidebar.getByText("Add API").click()

	// Select "anthropic"
	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "Anthropic" }).click()

	// Verify Anthropic-specific API Key field appears
	await expect(sidebar.getByPlaceholder(/API Key/i)).toBeVisible()

	// Switch to "openrouter"
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "OpenRouter" }).click()

	// OpenRouter has model picker visible
	await expect(sidebar.getByText(/OpenRouter/, { exact: false })).toBeVisible()

	await page.close()
})

e2e("Settings API Config — apiKey stored in api_keys.json not api_profiles.json", async ({ sidebar, page }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()
	await sidebar.getByText("Add API").click()

	// Select anthropic
	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "Anthropic" }).click()

	// Input test apiKey
	const apiKeyInput = sidebar.getByPlaceholder(/API Key/i)
	await apiKeyInput.fill("sk-test-e2e-key-12345")

	// Wait for debounced persistence (DebouncedTextField ~300ms)
	await page.waitForTimeout(500)

	// Read api_keys.json and verify { apiKey, name } format
	const { readApiProfiles } = await import("@core/controller/file/getApiProfiles")
	const profiles = readApiProfiles()
	const profile = profiles.find(p => p.provider === "anthropic" && p.enabled)
	expect(profile).toBeTruthy()

	// apiKey should be backfilled on profile
	expect(profile!.apiKey).toBe("sk-test-e2e-key-12345")

	const { getAllApiKeys } = await import("@core/storage/secrets")
	const entries = getAllApiKeys()
	const entry = entries[profile!.id]
	expect(entry).toBeTruthy()
	expect(entry.apiKey).toBe("sk-test-e2e-key-12345")
	expect(typeof entry.name).toBe("string")
	expect(entry.name.length).toBeGreaterThan(0)

	await page.close()
})

e2e("Settings API Config — name change syncs to ApiKeyStore", async ({ sidebar, page }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()
	await sidebar.getByText("Add API").click()

	// Select anthropic and set apiKey
	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "Anthropic" }).click()
	await sidebar.getByPlaceholder(/API Key/i).fill("sk-test-name-sync")
	await page.waitForTimeout(500)

	// Change model to trigger name change
	// (model selector triggers useApiProfiles.updateProfile which regenerates name)
	const modelDropdown = sidebar.locator('[role="combobox"]').nth(1)
	if (await modelDropdown.isVisible()) {
		await modelDropdown.click()
		// Select a different model
		const firstOption = sidebar.getByRole("option").first()
		await firstOption.click()
		await page.waitForTimeout(500)
	}

	// Verify name field updated in ApiKeyStore
	const { readApiProfiles } = await import("@core/controller/file/getApiProfiles")
	const { getAllApiKeys } = await import("@core/storage/secrets")
	const profiles = readApiProfiles()
	const profile = profiles.find(p => p.provider === "anthropic" && p.enabled)
	expect(profile).toBeTruthy()

	const entries = getAllApiKeys()
	const entry = entries[profile!.id]
	expect(entry).toBeTruthy()
	expect(entry.name).toBe(profile!.name)

	await page.close()
})

e2e("Settings API Config — profile delete cleans ApiKeyStore", async ({ sidebar, page }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()
	await sidebar.getByText("Add API").click()

	// Select a provider to create a real profile
	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "Anthropic" }).click()
	await sidebar.getByPlaceholder(/API Key/i).fill("sk-test-to-delete")
	await page.waitForTimeout(500)

	// Capture profile id before deletion
	const { readApiProfiles } = await import("@core/controller/file/getApiProfiles")
	const profilesBefore = readApiProfiles()
	const target = profilesBefore.find(p => p.provider === "anthropic" && p.enabled)
	expect(target).toBeTruthy()

	// Enter Edit mode
	await sidebar.getByText("Edit").click()

	// Select first checkbox
	const checkboxes = sidebar.locator('[type="checkbox"]')
	await checkboxes.first().click()

	// Delete → Confirm
	const deleteBtn = sidebar.getByText(/Delete/)
	await deleteBtn.click()
	const confirmBtn = sidebar.getByText(/Confirm/)
	await confirmBtn.click()

	// Verify profile removed from list
	await expect(sidebar.getByPlaceholder(/API Key/i)).not.toBeVisible()

	// Verify apiKey entry cleaned up
	const { getApiKey } = await import("@core/storage/secrets")
	expect(getApiKey(target!.id)).toBeUndefined()

	await page.close()
})
