import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Settings API Config - can add a new profile", async ({ sidebar }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()

	const addButton = sidebar.getByText("Add API")
	await expect(addButton).toBeVisible()
	await addButton.click()

	await expect(sidebar.locator('[role="combobox"]').first()).toBeVisible()
})

e2e("Settings API Config - switching provider renders correct form", async ({ sidebar }) => {
	await sidebar.getByTestId("settings-button").click()
	await sidebar.getByRole("tab", { name: /API/ }).click()
	await sidebar.getByText("Add API").click()

	const providerDropdown = sidebar.locator('[role="combobox"]').first()
	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "Anthropic" }).click()
	await expect(sidebar.getByPlaceholder(/API Key/i)).toBeVisible()

	await providerDropdown.click()
	await sidebar.getByRole("option", { name: "OpenRouter" }).click()
	await expect(sidebar.getByText(/OpenRouter/, { exact: false })).toBeVisible()
})
